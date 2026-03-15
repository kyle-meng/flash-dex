import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

export const getPoolPDA = (programId: PublicKey) => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool")],
    programId
  )[0];
};

export const getVaultPDA = (pool: PublicKey, mint: PublicKey, programId: PublicKey) => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), pool.toBuffer(), mint.toBuffer()],
    programId
  )[0];
};

export const getUserATA = (owner: PublicKey, mint: PublicKey) => {
  return getAssociatedTokenAddressSync(mint, owner);
};
