use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};
use anchor_lang::solana_program::sysvar::instructions::{
    load_current_index_checked, load_instruction_at_checked, ID as INSTRUCTIONS_ID,
};

declare_id!("9zwMoRvs4hfzLZ5PLWxVB1AJ8bkpDWXYdzcjBqmSZQG7");

#[program]
pub mod flash_dex {
    use super::*;

    // 1. Initialize Pool
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        fee_bps: u16,
        protocol_fee_bps: u16,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.authority_bump = ctx.bumps.pool;
        pool.token_a_mint = ctx.accounts.token_a_mint.key();
        pool.token_b_mint = ctx.accounts.token_b_mint.key();
        pool.fee_bps = fee_bps;
        pool.protocol_fee_bps = protocol_fee_bps;
        pool.is_flash_loaning = false;
        Ok(())
    }

    // 2. Deposit (Providing Liquidity)
    pub fn deposit(ctx: Context<Deposit>, amount_a: u64, amount_b: u64) -> Result<()> {
        // Transfer Token A from user to vault
        let cpi_accounts_a = Transfer {
            from: ctx.accounts.user_token_a.to_account_info(),
            to: ctx.accounts.vault_a.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts_a),
            amount_a,
        )?;

        // Transfer Token B from user to vault
        let cpi_accounts_b = Transfer {
            from: ctx.accounts.user_token_b.to_account_info(),
            to: ctx.accounts.vault_b.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts_b),
            amount_b,
        )?;

        // Note: Real LP logic would mint an LP token reflecting share of the pool.
        Ok(())
    }

    // 3. AMM Swap (Using CFMM and Direct Vault Balance)
    pub fn swap(
        ctx: Context<Swap>,
        amount_in: u64,
        min_out: u64,
        is_a_to_b: bool,
    ) -> Result<()> {
        // Safe: read state directly from Vault token amounts to avoid synchronization vulnerabilities
        let reserve_a = ctx.accounts.vault_a.amount;
        let reserve_b = ctx.accounts.vault_b.amount;

        let (reserve_in, reserve_out) = if is_a_to_b {
            (reserve_a, reserve_b)
        } else {
            (reserve_b, reserve_a)
        };

        // Mathematically safe fee calculation using checked operations
        // Output = [AmountInWithFee * ReserveOut] / [ReserveIn * 10000 + AmountInWithFee]
        let fee_multiplier = 10000u64.checked_sub(ctx.accounts.pool.fee_bps as u64).unwrap();
        let amount_in_with_fee = amount_in.checked_mul(fee_multiplier).unwrap();

        let numerator = amount_in_with_fee.checked_mul(reserve_out).unwrap();
        let denominator = reserve_in
            .checked_mul(10000)
            .unwrap()
            .checked_add(amount_in_with_fee)
            .unwrap();

        let amount_out = numerator.checked_div(denominator).unwrap();
        require!(amount_out >= min_out, DexError::SlippageExceeded);

        let cpi_program = ctx.accounts.token_program.to_account_info();

        // 1. Transfer tokens from User to Vault
        if is_a_to_b {
            let cpi_accounts_in = Transfer {
                from: ctx.accounts.user_token_a.to_account_info(),
                to: ctx.accounts.vault_a.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            };
            token::transfer(CpiContext::new(cpi_program.clone(), cpi_accounts_in), amount_in)?;
        } else {
            let cpi_accounts_in = Transfer {
                from: ctx.accounts.user_token_b.to_account_info(),
                to: ctx.accounts.vault_b.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            };
            token::transfer(CpiContext::new(cpi_program.clone(), cpi_accounts_in), amount_in)?;
        }

        // 2. Transfer tokens from Vault to User (Requires Pool PDA signature)
        let pool_seeds: &[&[&[u8]]] = &[&[
            b"pool",
            ctx.accounts.pool.token_a_mint.as_ref(),
            ctx.accounts.pool.token_b_mint.as_ref(),
            &[ctx.accounts.pool.authority_bump],
        ]];

        if is_a_to_b {
            let cpi_accounts_out = Transfer {
                from: ctx.accounts.vault_b.to_account_info(),
                to: ctx.accounts.user_token_b.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(cpi_program.clone(), cpi_accounts_out, pool_seeds),
                amount_out,
            )?;
        } else {
             let cpi_accounts_out = Transfer {
                from: ctx.accounts.vault_a.to_account_info(),
                to: ctx.accounts.user_token_a.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(cpi_program.clone(), cpi_accounts_out, pool_seeds),
                amount_out,
            )?;
        }

        Ok(())
    }

    // 4. Flash Loan Borrow
    pub fn flash_borrow(ctx: Context<FlashBorrow>, amount: u64, is_token_a: bool) -> Result<()> {
        require!(!ctx.accounts.pool.is_flash_loaning, DexError::ReentrancyGuard);

        let ixs = ctx.accounts.instructions.to_account_info();
        let current_idx = load_current_index_checked(&ixs)?;

        // Must not be the last instruction and we must find a valid repay later
        let mut found_repay = false;
        let mut idx = current_idx + 1;
        while let Ok(ix) = load_instruction_at_checked(idx as usize, &ixs) {
            if ix.program_id == crate::ID {
                let expected_discriminator: [u8; 8] = [182, 143, 19, 23, 39, 221, 184, 78]; // flash_repay
                if ix.data.len() >= 8 && ix.data[0..8] == expected_discriminator {
                    found_repay = true;
                    break;
                }
            }
            idx += 1;
        }

        require!(found_repay, DexError::InvalidRepay);

        ctx.accounts.pool.is_flash_loaning = true;

        let cpi_program = ctx.accounts.token_program.to_account_info();
        let pool_seeds: &[&[&[u8]]] = &[&[
            b"pool",
            ctx.accounts.pool.token_a_mint.as_ref(),
            ctx.accounts.pool.token_b_mint.as_ref(),
            &[ctx.accounts.pool.authority_bump],
        ]];

        if is_token_a {
            let cpi_accounts = Transfer {
                from: ctx.accounts.vault_a.to_account_info(),
                to: ctx.accounts.user_token_a.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(cpi_program, cpi_accounts, pool_seeds),
                amount,
            )?;
        } else {
            let cpi_accounts = Transfer {
                from: ctx.accounts.vault_b.to_account_info(),
                to: ctx.accounts.user_token_b.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(cpi_program, cpi_accounts, pool_seeds),
                amount,
            )?;
        }

        Ok(())
    }

    // 5. Flash Loan Repay
    pub fn flash_repay(ctx: Context<FlashRepay>, amount: u64, is_token_a: bool) -> Result<()> {
        require!(ctx.accounts.pool.is_flash_loaning, DexError::NoActiveFlashLoan);

        let ixs = ctx.accounts.instructions.to_account_info();
        let current_idx = load_current_index_checked(&ixs)?;

        let mut borrow_amount: u64 = 0;
        let mut found_borrow = false;
        let mut idx = (current_idx as i32) - 1;
        while idx >= 0 {
            if let Ok(ix) = load_instruction_at_checked(idx as usize, &ixs) {
                if ix.program_id == crate::ID {
                    let expected_discriminator: [u8; 8] = [166, 221, 220, 25, 61, 73, 127, 240]; // flash_borrow
                    if ix.data.len() >= 17 && ix.data[0..8] == expected_discriminator {
                        let mut amount_bytes = [0u8; 8];
                        amount_bytes.copy_from_slice(&ix.data[8..16]);
                        borrow_amount = u64::from_le_bytes(amount_bytes);

                        let _is_a = ix.data[16] != 0;
                        require!(_is_a == is_token_a, DexError::TokenMismatch);
                        found_borrow = true;
                        break;
                    }
                }
            }
            idx -= 1;
        }

        require!(found_borrow, DexError::InvalidBorrow);

        // Calculate flash loan fee (0.1%)
        let fee = borrow_amount.checked_mul(1).unwrap().checked_div(1000).unwrap();
        let required_repay = borrow_amount.checked_add(fee).unwrap();

        require!(amount >= required_repay, DexError::InsufficientRepay);

        let cpi_program = ctx.accounts.token_program.to_account_info();
        if is_token_a {
            let cpi_accounts = Transfer {
                from: ctx.accounts.user_token_a.to_account_info(),
                to: ctx.accounts.vault_a.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            };
            token::transfer(CpiContext::new(cpi_program, cpi_accounts), amount)?;
        } else {
            let cpi_accounts = Transfer {
                from: ctx.accounts.user_token_b.to_account_info(),
                to: ctx.accounts.vault_b.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            };
            token::transfer(CpiContext::new(cpi_program, cpi_accounts), amount)?;
        }

        ctx.accounts.pool.is_flash_loaning = false;
        
        emit!(FlashLoanEvent {
            borrower: ctx.accounts.user.key(),
            amount: borrow_amount,
            fee,
            is_token_a,
        });

        Ok(())
    }
}

// ------------------------
// Instructions / Contexts
// ------------------------

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(
        init,
        payer = payer,
        // space: 8 (discriminator) + 1 (bump) + 32 + 32 + 2 + 2 + 1 = 78
        space = 8 + 78,
        seeds = [b"pool", token_a_mint.key().as_ref(), token_b_mint.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,
    
    pub token_a_mint: Account<'info, Mint>,
    pub token_b_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = token_a_mint,
        associated_token::authority = pool,
    )]
    pub vault_a: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = token_b_mint,
        associated_token::authority = pool,
    )]
    pub vault_b: Account<'info, TokenAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.token_a_mint.as_ref(), pool.token_b_mint.as_ref()],
        bump = pool.authority_bump
    )]
    pub pool: Account<'info, Pool>,

    #[account(mut, associated_token::mint = pool.token_a_mint, associated_token::authority = user)]
    pub user_token_a: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = pool.token_b_mint, associated_token::authority = user)]
    pub user_token_b: Account<'info, TokenAccount>,

    #[account(mut, associated_token::mint = pool.token_a_mint, associated_token::authority = pool)]
    pub vault_a: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = pool.token_b_mint, associated_token::authority = pool)]
    pub vault_b: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.token_a_mint.as_ref(), pool.token_b_mint.as_ref()],
        bump = pool.authority_bump
    )]
    pub pool: Account<'info, Pool>,

    #[account(mut, associated_token::mint = pool.token_a_mint, associated_token::authority = user)]
    pub user_token_a: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = pool.token_b_mint, associated_token::authority = user)]
    pub user_token_b: Account<'info, TokenAccount>,

    #[account(mut, associated_token::mint = pool.token_a_mint, associated_token::authority = pool)]
    pub vault_a: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = pool.token_b_mint, associated_token::authority = pool)]
    pub vault_b: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct FlashBorrow<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.token_a_mint.as_ref(), pool.token_b_mint.as_ref()],
        bump = pool.authority_bump
    )]
    pub pool: Account<'info, Pool>,

    #[account(mut, constraint = user_token_a.mint == pool.token_a_mint)]
    pub user_token_a: Account<'info, TokenAccount>,
    #[account(mut, constraint = user_token_b.mint == pool.token_b_mint)]
    pub user_token_b: Account<'info, TokenAccount>,

    #[account(mut, associated_token::mint = pool.token_a_mint, associated_token::authority = pool)]
    pub vault_a: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = pool.token_b_mint, associated_token::authority = pool)]
    pub vault_b: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    /// CHECK: Instructions sysvar checking via loaded ID matching
    #[account(address = INSTRUCTIONS_ID)]
    pub instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct FlashRepay<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool", pool.token_a_mint.as_ref(), pool.token_b_mint.as_ref()],
        bump = pool.authority_bump
    )]
    pub pool: Account<'info, Pool>,

    #[account(mut, constraint = user_token_a.mint == pool.token_a_mint)]
    pub user_token_a: Account<'info, TokenAccount>,
    #[account(mut, constraint = user_token_b.mint == pool.token_b_mint)]
    pub user_token_b: Account<'info, TokenAccount>,

    #[account(mut, associated_token::mint = pool.token_a_mint, associated_token::authority = pool)]
    pub vault_a: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = pool.token_b_mint, associated_token::authority = pool)]
    pub vault_b: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    /// CHECK: Instructions sysvar checking via loaded ID matching
    #[account(address = INSTRUCTIONS_ID)]
    pub instructions: UncheckedAccount<'info>,
}

// ------------------------
// State Accounts
// ------------------------

#[account]
pub struct Pool {
    pub authority_bump: u8,
    pub token_a_mint: Pubkey,
    pub token_b_mint: Pubkey,
    pub fee_bps: u16,           // Liquidity provider fees (e.g. 30bps = 0.3%)
    pub protocol_fee_bps: u16,  // Protocol treasury fee (e.g. 5bps = 0.05%)
    pub is_flash_loaning: bool, // Strict reentrancy guard for Flashloans
}

// ------------------------
// Events
// ------------------------

#[event]
pub struct FlashLoanEvent {
    pub borrower: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub is_token_a: bool,
}

// ------------------------
// Errors
// ------------------------

#[error_code]
pub enum DexError {
    #[msg("Slippage limit exceeded: Received output is less than minimum expected.")]
    SlippageExceeded,
    #[msg("Reentrancy Guard: Flash loan already active.")]
    ReentrancyGuard,
    #[msg("Must be first instruction in sequence.")]
    MustBeFirst,
    #[msg("Invalid Repay Instruction.")]
    InvalidRepay,
    #[msg("Invalid Borrow Instruction.")]
    InvalidBorrow,
    #[msg("Token Mismatch between borrow and repay.")]
    TokenMismatch,
    #[msg("Insufficient Repay Amount.")]
    InsufficientRepay,
    #[msg("No Active Flash Loan.")]
    NoActiveFlashLoan,
}
