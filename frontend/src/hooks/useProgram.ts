import { useMemo } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Program, AnchorProvider, Idl } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import idl from '../idl/flash_dex.json';

import { FlashDex } from '../idl/flash_dex';

export const PROGRAM_ID = new PublicKey("9zwMoRvs4hfzLZ5PLWxVB1AJ8bkpDWXYdzcjBqmSZQG7");

export function useProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const program = useMemo(() => {
    if (!wallet.publicKey) return null;

    const provider = new AnchorProvider(
      connection,
      wallet as any,
      AnchorProvider.defaultOptions()
    );

    return new Program<FlashDex>(idl as any, provider);
  }, [connection, wallet]);

  return program;
}
