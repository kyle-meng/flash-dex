use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
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
// Errors
// ------------------------

#[error_code]
pub enum DexError {
    #[msg("Slippage limit exceeded: Received output is less than minimum expected.")]
    SlippageExceeded,
}
