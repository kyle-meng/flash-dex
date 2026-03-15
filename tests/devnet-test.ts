import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { FlashDex } from "../target/types/flash_dex";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

/**
 * Devnet Test Script
 * 
 * Usage:
 * ANCHOR_PROVIDER_URL="https://api.devnet.solana.com" \
 * ANCHOR_WALLET="~/.config/solana/id.json" \
 * MINT_A="GKdgP7W5cPMgvH7pptqAZyUcgruSJmFyQhbGbp4SZdcb" \
 * MINT_B="A4axmCec6CpupCrGVjHSYiz3xoXf8LjifRMEdg638hGY" \
 * npx ts-node tests/devnet-test.ts
 */

async function main() {
  // 1. Setup Provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const payer = (provider.wallet as any).payer || provider.wallet;

  const program = anchor.workspace.FlashDex as Program<FlashDex>;
  console.log("Program ID:", program.programId.toBase58());

  // 2. Get Mint Addresses from Env or use placeholders
  const mintAStr = process.env.MINT_A;
  const mintBStr = process.env.MINT_B;

  if (!mintAStr || !mintBStr) {
    console.error("❌ Error: MINT_A and MINT_B environment variables are required.");
    console.log("Example: MINT_A=xxx MINT_B=yyy npx ts-node tests/devnet-test.ts");
    process.exit(1);
  }

  const tokenAMint = new PublicKey(mintAStr);
  const tokenBMint = new PublicKey(mintBStr);

  // 3. Derive PDA and Vaults
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), tokenAMint.toBuffer(), tokenBMint.toBuffer()],
    program.programId
  );

  const vaultA = getAssociatedTokenAddressSync(tokenAMint, poolPda, true);
  const vaultB = getAssociatedTokenAddressSync(tokenBMint, poolPda, true);
  
  const userTokenA = getAssociatedTokenAddressSync(tokenAMint, provider.publicKey);
  const userTokenB = getAssociatedTokenAddressSync(tokenBMint, provider.publicKey);

  console.log("Pool PDA:", poolPda.toBase58());
  console.log("Vault A:", vaultA.toBase58());
  console.log("Vault B:", vaultB.toBase58());

  // // 4. Initialize Pool (if not already done)
  // try {
  //   const poolAccount = await program.account.pool.fetch(poolPda);
  //   console.log("✅ Pool already exists. Skipping initialization.");
  // } catch (e) {
  //   console.log("🔨 Initializing Pool...");
  //   const tx = await program.methods
  //     .initializePool(30, 5) // 30 bps fee, 5 bps protocol fee
  //     .accounts({
  //       pool: poolPda,
  //       tokenAMint: tokenAMint,
  //       tokenBMint: tokenBMint,
  //       vaultA,
  //       vaultB,
  //       payer: provider.publicKey,
  //       systemProgram: SystemProgram.programId,
  //       tokenProgram: TOKEN_PROGRAM_ID,
  //       associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  //     } as any)
  //     .rpc();
  //   console.log("🚀 Pool Initialized. Signature:", tx);
  // }

  // // 5. Deposit 100 Tokens to each side
  // // Ensure you have balance!
  // console.log("💰 Depositing liquidity...");
  // const userTokenA_depositAmount = new BN(400_000_000_000_000); // 0.1 tokens if 9 decimals
  // const userTokenB_depositAmount = new BN(500_000_000_000_000); // 0.1 tokens if 9 decimals

  // try {
  //   const depositTx = await program.methods
  //     .deposit(userTokenA_depositAmount, userTokenB_depositAmount)
  //     .accounts({
  //       user: provider.publicKey,
  //       pool: poolPda,
  //       userTokenA,
  //       userTokenB,
  //       vaultA,
  //       vaultB,
  //       tokenProgram: TOKEN_PROGRAM_ID,
  //     } as any)
  //     .rpc();
  //   console.log("✅ Deposit successful. Signature:", depositTx);
  // } catch (error: any) {
  //   console.error("❌ Deposit failed:", error.logs ? error.logs : error.message);
  // }

  // // 6. Flash Loan Test (Borrow -> Repay)
  // console.log("⚡️ Executing Flash Loan [Borrow -> Repay]...");
  // const borrowAmount = new BN(10_000_000); // 0.01 tokens
  // const borrowFee = borrowAmount.mul(new BN(1)).div(new BN(1000)); // 0.1% fee
  // const requiredRepay = borrowAmount.add(borrowFee);

  // const borrowIx = await program.methods
  //   .flashBorrow(borrowAmount, true) // isTokenA
  //   .accounts({
  //     user: provider.publicKey,
  //     pool: poolPda,
  //     userTokenA,
  //     userTokenB,
  //     vaultA,
  //     vaultB,
  //     tokenProgram: TOKEN_PROGRAM_ID,
  //     instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
  //   } as any)
  //   .instruction();

  // const repayIx = await program.methods
  //   .flashRepay(requiredRepay, true)
  //   .accounts({
  //     user: provider.publicKey,
  //     pool: poolPda,
  //     userTokenA,
  //     userTokenB,
  //     vaultA,
  //     vaultB,
  //     tokenProgram: TOKEN_PROGRAM_ID,
  //     instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
  //   } as any)
  //   .instruction();

  // const flashTx = new Transaction().add(borrowIx, repayIx);
  // try {
  //   const signature = await anchor.web3.sendAndConfirmTransaction(provider.connection, flashTx, [payer]);
  //   console.log("✅ Flash Loan successful! Signature:", signature);
  // } catch (error: any) {
  //   console.error("❌ Flash Loan failed:", error.logs ? error.logs : error.message);
  // }


  // 7. Swap Test
  console.log("Swap Token");
  const isAToB = true;
  const swapIx = await program.methods
    .swap(new BN(10), new BN(0), isAToB)
    .accounts({
      user: provider.publicKey,
      pool: poolPda,
      userTokenA,
      userTokenB,
      vaultA,
      vaultB,
      tokenProgram: TOKEN_PROGRAM_ID,
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
    }as any)
    .instruction();


  const tx = new Transaction().add(swapIx);
  await provider.sendAndConfirm(tx, [payer]);
  if (isAToB) {
    console.log("\x1b[32m%s\x1b[0m", "     ✔ Swap Token A for Token B successfully.");
  } else {
    console.log("\x1b[32m%s\x1b[0m", "     ✔ Swap Token B for Token A successfully.");
  }


  console.log("\n🎉 Devnet Testing Complete!");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
