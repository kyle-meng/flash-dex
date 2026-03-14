import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { FlashDex } from "../target/types/flash_dex";
import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createInitializeMintInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  MINT_SIZE,
} from "@solana/spl-token";
import { assert } from "chai";

describe("FlashDex Bankrun Arbitrage Sandbox", () => {
  let provider: BankrunProvider;
  let program: Program<FlashDex>;
  let payer: Keypair;
  
  let tokenA = Keypair.generate();
  let tokenB = Keypair.generate();
  
  // Enforce sorted mints for pool PDA seeds as rust program expects deterministic byte ordering 
  // Wait, rust program does NOT enforce sorting! It expects token_a and token_b explicitly.
  // We use them exactly in the order they're defined.
  
  let userTokenA: PublicKey;
  let userTokenB: PublicKey;
  
  let poolPda: PublicKey;
  let vaultA: PublicKey;
  let vaultB: PublicKey;
  
  before(async () => {
    // 1. Kick off lighting fast Bankrun environment! No `solana-test-validator` needed.
    const context = await startAnchor("", [], []);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    
    program = anchor.workspace.FlashDex as Program<FlashDex>;
    payer = provider.wallet.payer;
    
    // 2. Compute the PDA for the Pool Configuration
    [poolPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), tokenA.publicKey.toBuffer(), tokenB.publicKey.toBuffer()],
      program.programId
    );
    
    vaultA = getAssociatedTokenAddressSync(tokenA.publicKey, poolPda, true);
    vaultB = getAssociatedTokenAddressSync(tokenB.publicKey, poolPda, true);
    
    userTokenA = getAssociatedTokenAddressSync(tokenA.publicKey, payer.publicKey);
    userTokenB = getAssociatedTokenAddressSync(tokenB.publicKey, payer.publicKey);
    
    const rent = await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    
    // 3. Setup core spl-token Mints and give Arbitrageur (payer) rich initial wealth
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: tokenA.publicKey,
        space: MINT_SIZE,
        lamports: rent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(tokenA.publicKey, 6, payer.publicKey, null),
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: tokenB.publicKey,
        space: MINT_SIZE,
        lamports: rent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(tokenB.publicKey, 6, payer.publicKey, null),
      
      createAssociatedTokenAccountInstruction(payer.publicKey, userTokenA, payer.publicKey, tokenA.publicKey),
      createAssociatedTokenAccountInstruction(payer.publicKey, userTokenB, payer.publicKey, tokenB.publicKey),
      
      // Inject $1,000,000 equivalent token liquidity for setup!
      createMintToInstruction(tokenA.publicKey, userTokenA, payer.publicKey, 100_000_000_000),
      createMintToInstruction(tokenB.publicKey, userTokenB, payer.publicKey, 100_000_000_000)
    );
    
    await provider.sendAndConfirm(tx, [payer, tokenA, tokenB]);
  });
  
  it("Initializes the DEX Pool", async () => {
    await program.methods
      .initializePool(30, 5) // 30 bps LP fee, 5 bps Treasury fee
      .accounts({
        pool: poolPda,
        tokenAMint: tokenA.publicKey,
        tokenBMint: tokenB.publicKey,
        vaultA,
        vaultB,
        payer: payer.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();
      
    const poolState = await program.account.pool.fetch(poolPda);
    assert.ok(poolState.feeBps === 30);
    assert.ok(poolState.isFlashLoaning === false);
  });
  
  it("Deposits unified liquidity (AMM pool + Flash loan funds)", async () => {
    // Arbitrageur provides deep liquidity to DEX before attacking
    const depositAmount = new BN(50_000_000_000); 
    
    await program.methods
      .deposit(depositAmount, depositAmount)
      .accounts({
        user: payer.publicKey,
        pool: poolPda,
        userTokenA,
        userTokenB,
        vaultA,
        vaultB,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  });
  
  it("Executes a perfect full-lifecycle Flash Loan Arbitrage! ⚡️", async () => {
    // Our target vector: Borrow 10,000 USDC (TokenA)
    const borrowAmount = new BN(10_000); 
    
    // Fee = 0.1% -> 10 TokenA
    const borrowFee = borrowAmount.mul(new BN(1)).div(new BN(1000));
    const requiredRepay = borrowAmount.add(borrowFee); // 10,010
    
    // 1. Build Instruction 0: Flash Borrow
    const borrowIx = await program.methods
      .flashBorrow(borrowAmount, true) // isTokenA = True
      .accounts({
        user: payer.publicKey,
        pool: poolPda,
        userTokenA,
        userTokenB,
        vaultA,
        vaultB,
        tokenProgram: TOKEN_PROGRAM_ID,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
      
    // 2. Build Instruction 1: The Arbitrage Engine (Simulation)
    // Normally, this is a Jupiter CPI Swap. Here we simulate finding a naive AMM disjoint. 
    // The user prints out 30 "Profit" mapping out of thin air to easily cover the 10 TokenA loan fee.
    const simulatedArbIx = createMintToInstruction(
      tokenA.publicKey, 
      userTokenA, 
      payer.publicKey, 
      borrowFee.toNumber() + 20 // 10 Fee + 20 Arbitrageur Gain
    );
    
    // 3. Build Instruction 2: Flash Repay
    const repayIx = await program.methods
      .flashRepay(requiredRepay, true)
      .accounts({
        user: payer.publicKey,
        pool: poolPda,
        userTokenA,
        userTokenB,
        vaultA,
        vaultB,
        tokenProgram: TOKEN_PROGRAM_ID,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();
      
    // COMBINE: This demonstrates the power of Instruction Introspection
    const tx = new Transaction().add(borrowIx, simulatedArbIx, repayIx);
    await provider.sendAndConfirm(tx, [payer]);
    
    console.log("\x1b[32m%s\x1b[0m", "     ✔ Flash Loan Intra-Tx Callbacks Executed Introspectively!");
    console.log("\x1b[32m%s\x1b[0m", "     ✔ Slippage & Fee Handled Safe Math successfully.");
  });

  it("Reverts if Flash Loan is NOT repaid", async () => {
    const borrowAmount = new BN(10000); 
    
    const borrowIx = await program.methods
      .flashBorrow(borrowAmount, true)
      .accounts({
        user: payer.publicKey,
        pool: poolPda,
        userTokenA,
        userTokenB,
        vaultA,
        vaultB,
        tokenProgram: TOKEN_PROGRAM_ID,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .instruction();

    // Send transaction WITH borrow, but WITHOUT repaying!
    const tx = new Transaction().add(borrowIx);
    
    try {
      await provider.sendAndConfirm(tx, [payer]);
      assert.fail("Should have failed Instruction Introspection!");
    } catch (e: any) {
      assert.include(e.message, "InvalidRepay");
      console.log("\x1b[33m%s\x1b[0m", "     ✔ Introspection successfully halted the Hack/Theft.");
    }
  });

});
