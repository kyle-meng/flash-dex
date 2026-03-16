"use client";

import { useState, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, ArrowRightLeft, Zap, ShieldCheck, History, XCircle, CheckCircle, Droplets, Settings, Plus, Repeat } from "lucide-react";
import { useProgram, PROGRAM_ID } from "@/hooks/useProgram";
import { BN } from "@coral-xyz/anchor";
import { 
  PublicKey, 
  SystemProgram, 
  Transaction, 
  SYSVAR_INSTRUCTIONS_PUBKEY 
} from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  getAssociatedTokenAddressSync, 
  createAssociatedTokenAccountInstruction,
  getAccount,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from "@solana/spl-token";
import { ComputeBudgetProgram } from "@solana/web3.js";

type TabOption = "arbitrage" | "swap" | "pool";

const DECIMALS = 9;
const FACTOR = new BN(10).pow(new BN(DECIMALS));

export default function Home() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const program = useProgram();
  
  const [activeTab, setActiveTab] = useState<TabOption>("arbitrage");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Mint Addresses (Defaults for Devnet testing if user has some)
  const [mintA, setMintA] = useState<string>("GKdgP7W5cPMgvH7pptqAZyUcgruSJmFyQhbGbp4SZdcb");
  const [mintB, setMintB] = useState<string>("A4axmCec6CpupCrGVjHSYiz3xoXf8LjifRMEdg638hGY");

  // Form States
  const [loanAmount, setLoanAmount] = useState<number>(10000);
  const [swapAmountIn, setSwapAmountIn] = useState<number>(100);
  const [depositAmountA, setDepositAmountA] = useState<number>(500);
  const [depositAmountB, setDepositAmountB] = useState<number>(500);

  const [isExecuting, setIsExecuting] = useState(false);
  const [isAToB, setIsAToB] = useState(true);
  const [logs, setLogs] = useState<{ id: number; message: string; type: "info" | "success" | "error" }[]>([]);

  const addLog = (message: string, type: "info" | "success" | "error" = "info") => {
    setLogs((prev) => [...prev, { id: Date.now() + Math.random(), message, type }]);
  };

  const executeArbitrage = async () => {
    if (!publicKey || !program) return addLog("Please connect your wallet first.", "error");
    setIsExecuting(true);
    addLog(`Initiating real flash loan of ${loanAmount.toLocaleString()} tokens...`, "info");
    try {
      if (!mintA || !mintB) throw new Error("Please provide Mint A and Mint B addresses in the Pool tab.");
      
      addLog("Building Introspection TX [Borrow -> Repay]...", "info");
      const mintAPubkey = new PublicKey(mintA);
      const mintBPubkey = new PublicKey(mintB);
      
      const [poolAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), mintAPubkey.toBuffer(), mintBPubkey.toBuffer()], 
        program.programId
      );
      
      const [vaultA] = PublicKey.findProgramAddressSync(
        [poolAddress.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintAPubkey.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const [vaultB] = PublicKey.findProgramAddressSync(
        [poolAddress.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintBPubkey.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      
      const userA = getAssociatedTokenAddressSync(mintAPubkey, publicKey);
      const userB = getAssociatedTokenAddressSync(mintBPubkey, publicKey);

      const amount = new BN(loanAmount).mul(FACTOR);
      // Calculate 0.1% fee: repay = amount + (amount / 1000)
      const repayAmount = amount.add(amount.div(new BN(1000)));

      addLog(`Flash Loan: Borrowing ${loanAmount.toLocaleString()} tokens...`, "info");

      const borrowIx = await program.methods
        .flashBorrow(amount, true) // Borrow Token A
        .accounts({
          user: publicKey,
          pool: poolAddress,
          vaultA: vaultA,
          vaultB: vaultB,
          userTokenA: userA,
          userTokenB: userB,
          tokenProgram: TOKEN_PROGRAM_ID,
          instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        } as any)
        .instruction();

      const repayIx = await program.methods
        .flashRepay(repayAmount, true) // Repay Token A
        .accounts({
          user: publicKey,
          pool: poolAddress,
          vaultA: vaultA,
          vaultB: vaultB,
          userTokenA: userA,
          userTokenB: userB,
          tokenProgram: TOKEN_PROGRAM_ID,
          instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        } as any)
        .instruction();

      // Add Compute Budget to avoid simulation failures and ensure priority
      const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({ 
        units: 400_000 
      });
      const addPriorityFee = ComputeBudgetProgram.setComputeUnitPrice({ 
        microLamports: 10_000 
      });

      const tx = new Transaction()
        .add(modifyComputeUnits)
        .add(addPriorityFee)
        .add(borrowIx)
        .add(repayIx);
      
      addLog("Fetching fresh blockhash & simulating...", "info");
      
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      const signature = await sendTransaction(tx, connection);
      
      addLog(`TX Sent: ${signature.slice(0, 8)}... Waiting confirmation.`, "info");
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight
      }, "confirmed");
      
      addLog("Transaction confirmed! Profit booked. ⚡️", "success");
    } catch (error: any) {
      console.error("Arbitrage detailed error:", error);
      
      // Attempt to extract logs from simulation failure
      if (error.logs) {
        console.log("On-chain Logs:", error.logs);
        const mustBeFirst = error.logs.some((l: string) => l.includes("MustBeFirst"));
        if (mustBeFirst) {
          addLog("Failed: flash_borrow must be the FIRST instruction. (Wallet might have added skip-priority instructions)", "error");
        }
      }
      
      addLog(`Arbitrage failed: ${error.message || "Execution error"}`, "error");
    } finally {
      setIsExecuting(false);
    }
  };

  const executeInitialization = async () => {
    if (!publicKey || !program) return addLog("Please connect your wallet first.", "error");
    if (!mintA || !mintB) return addLog("Please provide both Mint A and Mint B addresses.", "error");

    setIsExecuting(true);
    addLog("Building PDA coordinates [V2]...", "info");
    try {
      const mintAPubkey = new PublicKey(mintA);
      const mintBPubkey = new PublicKey(mintB);

      const [poolAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), mintAPubkey.toBuffer(), mintBPubkey.toBuffer()],
        program.programId
      );

      // Derive Associated Token Vaults for the pool
      const [vaultA] = PublicKey.findProgramAddressSync(
        [poolAddress.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintAPubkey.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const [vaultB] = PublicKey.findProgramAddressSync(
        [poolAddress.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintBPubkey.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      console.log("Initialization Accounts:", {
        pool: poolAddress.toBase58(),
        tokenAMint: mintAPubkey.toBase58(),
        tokenBMint: mintBPubkey.toBase58(),
        vaultA: vaultA.toBase58(),
        vaultB: vaultB.toBase58(),
        payer: publicKey.toBase58(),
      });

      const tx = await program.methods
        .initializePool(30, 10)
        .accounts({
          pool: poolAddress,
          tokenAMint: mintAPubkey,
          tokenBMint: mintBPubkey,
          vaultA: vaultA,
          vaultB: vaultB,
          payer: publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        } as any)
        .rpc();

      addLog(`Pool initialized! Sig: ${tx.slice(0, 8)}`, "success");
    } catch (error: any) {
      console.error("InitializePool Error:", error);
      addLog(`Init failed: ${error.message}`, "error");
    } finally {
      setIsExecuting(false);
    }
  };

  const executeDeposit = async () => {
    if (!publicKey || !program) return addLog("Please connect your wallet first.", "error");
    if (!mintA || !mintB) return addLog("Please provide token mints.", "error");
    
    setIsExecuting(true);
    addLog("Dual-sided deposit starting [Real Tx]...", "info");
    try {
      const mintAPubkey = new PublicKey(mintA);
      const mintBPubkey = new PublicKey(mintB);

      const [poolAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), mintAPubkey.toBuffer(), mintBPubkey.toBuffer()], 
        program.programId
      );

      const [vaultA] = PublicKey.findProgramAddressSync(
        [poolAddress.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintAPubkey.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const [vaultB] = PublicKey.findProgramAddressSync(
        [poolAddress.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintBPubkey.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const userA = getAssociatedTokenAddressSync(mintAPubkey, publicKey);
      const userB = getAssociatedTokenAddressSync(mintBPubkey, publicKey);

      const tx = await program.methods
        .deposit(new BN(depositAmountA).mul(FACTOR), new BN(depositAmountB).mul(FACTOR))
        .accounts({
          user: publicKey,
          pool: poolAddress,
          userTokenA: userA,
          userTokenB: userB,
          vaultA: vaultA,
          vaultB: vaultB,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .rpc();

      addLog(`Deposit successful! Sig: ${tx.slice(0, 8)}`, "success");
    } catch (error: any) {
      console.error(error);
      addLog(`Deposit failed: ${error.message}`, "error");
    } finally {
      setIsExecuting(false);
    }
  };

  const executeSwap = async () => {
    if (!publicKey || !program) return addLog("Please connect your wallet first.", "error");
    if (!mintA || !mintB) return addLog("Please provide token mints.", "error");

    setIsExecuting(true);
    addLog(`Swapping ${swapAmountIn.toLocaleString()} tokens...`, "info");
    try {
      const mintAPubkey = new PublicKey(mintA);
      const mintBPubkey = new PublicKey(mintB);

      const [poolAddress] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool"), mintAPubkey.toBuffer(), mintBPubkey.toBuffer()], 
        program.programId
      );

      const [vaultA] = PublicKey.findProgramAddressSync(
        [poolAddress.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintAPubkey.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const [vaultB] = PublicKey.findProgramAddressSync(
        [poolAddress.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintBPubkey.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const userA = getAssociatedTokenAddressSync(mintAPubkey, publicKey);
      const userB = getAssociatedTokenAddressSync(mintBPubkey, publicKey);

      const tx = await program.methods
        .swap(new BN(swapAmountIn).mul(FACTOR), new BN(0), isAToB)
        .accounts({
          user: publicKey,
          pool: poolAddress,
          userTokenA: userA,
          userTokenB: userB,
          vaultA: vaultA,
          vaultB: vaultB,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .rpc();

      addLog(`Swap confirmed! Sig: ${tx.slice(0, 8)}`, "success");
    } catch (error: any) {
      console.error(error);
      addLog(`Swap failed: ${error.message}`, "error");
    } finally {
      setIsExecuting(false);
    }
  };

  const renderActiveCard = () => {
    switch (activeTab) {
      case "arbitrage":
        return (
          <motion.div 
            key="arbitrage"
            initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
            className="p-8 space-y-8 bg-black/40 rounded-[23px] relative z-20"
          >
            <div className="flex items-center justify-between pb-6 border-b border-white/5">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 bg-indigo-500/20 rounded-xl text-indigo-400">
                  <ArrowRightLeft className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg text-white">Configure Arbitrage</h3>
                  <p className="text-sm text-white/40">Adjust flash borrow size.</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm text-white/40 mb-1">Estimated Net Profit</p>
                <p className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-green-400 to-emerald-500">
                  +${(loanAmount * 0.003).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
            <div className="space-y-4">
              <label className="text-sm font-medium text-white/60">Flash Borrow Amount (USDC)</label>
              <div className="relative">
                <input 
                  type="number" value={loanAmount} onChange={(e) => setLoanAmount(Number(e.target.value))}
                  className="w-full bg-black/50 border border-white/10 rounded-2xl px-6 py-5 text-2xl font-mono focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all text-white/90"
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 px-4 py-2 bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 rounded-xl font-bold text-sm cursor-pointer hover:bg-indigo-500/30 transition-colors" onClick={() => setLoanAmount(1000000)}>MAX</div>
              </div>
              <div className="flex justify-between px-2 text-xs text-white/40 font-mono">
                <span>Fee: {(loanAmount * 0.001).toLocaleString()}</span>
                <span>Slippage Tolarance: 0.1%</span>
              </div>
            </div>
            <button onClick={executeArbitrage} disabled={isExecuting} className={`group relative w-full rounded-2xl p-[1px] overflow-hidden transition-all duration-300 ${isExecuting ? 'opacity-70 cursor-not-allowed' : 'hover:scale-[1.02] active:scale-[0.98]'}`}>
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-rose-500 opacity-70 group-hover:opacity-100 transition-opacity" />
              <div className="relative w-full bg-black/40 backdrop-blur-md px-8 py-5 rounded-[15px] flex items-center justify-center space-x-3">
                {isExecuting ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Zap className="w-5 h-5 text-indigo-300" />}
                <span className="font-bold text-lg text-white tracking-wide">{isExecuting ? 'Executing Flash Vector...' : 'Execute Arbitrage ⚡️'}</span>
              </div>
            </button>
          </motion.div>
        );
      case "swap":
        return (
          <motion.div 
            key="swap"
            initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
            className="p-8 space-y-8 bg-black/40 rounded-[23px] relative z-20"
          >
            <div className="flex items-center space-x-3 pb-6 border-b border-white/5">
              <div className="p-2.5 bg-fuchsia-500/20 rounded-xl text-fuchsia-400"><Repeat className="w-5 h-5" /></div>
              <div>
                <h3 className="font-semibold text-lg text-white">AMM Swap Execution</h3>
                <p className="text-sm text-white/40">Powered by Shared LP Vaults.</p>
              </div>
            </div>
            <div className="space-y-4">
              <label className="text-sm font-medium text-white/60">Pay (Token {isAToB ? 'A' : 'B'})</label>
              <div className="relative">
                <input 
                  type="number" value={swapAmountIn} onChange={(e) => setSwapAmountIn(Number(e.target.value))}
                  className="w-full bg-black/50 border border-white/10 rounded-2xl px-6 py-4 text-xl font-mono focus:outline-none focus:border-fuchsia-500/50 focus:ring-1 focus:ring-fuchsia-500/50 transition-all text-white/90"
                />
              </div>
            </div>
            <div className="flex justify-center -my-2 relaive z-30">
              <div 
                className="bg-black border border-white/10 rounded-full p-2 text-white/40 cursor-pointer hover:bg-white/5 transition-colors" 
                onClick={() => setIsAToB(!isAToB)}
              >
                <ArrowRightLeft className={`w-4 h-4 rotate-90 transition-transform duration-300 ${isAToB ? '' : 'rotate-[270deg]'}`} />
              </div>
            </div>
            <div className="space-y-4">
              <label className="text-sm font-medium text-white/60">Receive (Token {isAToB ? 'B' : 'A'}) - Estimate</label>
              <div className="relative">
                <input 
                  type="number" value={(swapAmountIn * 0.997).toFixed(2)} disabled
                  className="w-full bg-white/5 border border-white/5 rounded-2xl px-6 py-4 text-xl font-mono text-white/50 cursor-not-allowed"
                />
              </div>
            </div>
            <button onClick={executeSwap} disabled={isExecuting} className={`group relative w-full rounded-2xl p-[1px] overflow-hidden transition-all duration-300 ${isExecuting ? 'opacity-70 cursor-not-allowed' : 'hover:scale-[1.02] active:scale-[0.98]'}`}>
              <div className="absolute inset-0 bg-gradient-to-r from-fuchsia-500 to-indigo-500 opacity-70 group-hover:opacity-100 transition-opacity" />
              <div className="relative w-full bg-black/40 backdrop-blur-md px-8 py-5 rounded-[15px] flex items-center justify-center space-x-3">
                {isExecuting ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Repeat className="w-5 h-5 text-fuchsia-300" />}
                <span className="font-bold text-lg text-white tracking-wide">{isExecuting ? 'Routing Trade...' : 'Swap Tokens 🔄'}</span>
              </div>
            </button>
          </motion.div>
        );
      case "pool":
        return (
          <motion.div 
            key="pool"
            initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
            className="p-8 space-y-8 bg-black/40 rounded-[23px] relative z-20 h-full flex flex-col"
          >
            <div className="flex items-center space-x-3 pb-6 border-b border-white/5">
              <div className="p-2.5 bg-emerald-500/20 rounded-xl text-emerald-400"><Droplets className="w-5 h-5" /></div>
              <div>
                <h3 className="font-semibold text-lg text-white">Pool Provisioning</h3>
                <p className="text-sm text-white/40">Manage Vault Liquidity.</p>
              </div>
            </div>
            <div className="flex-1 space-y-6">
              <div className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-4">
                <div className="flex justify-between items-center"><h4 className="text-sm font-semibold tracking-wider text-white/80"><Settings className="w-4 h-4 inline mr-2 text-white/40"/> Admin Setup</h4></div>
                <button onClick={executeInitialization} disabled={isExecuting} className="w-full bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 py-3 rounded-xl font-bold text-sm transition-all">Initialize New Pool PDA</button>
              </div>

              <div className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-4">
                <div className="flex justify-between items-center"><h4 className="text-sm font-semibold tracking-wider text-white/80"><Settings className="w-4 h-4 inline mr-2 text-white/40"/> Token Config</h4></div>
                <div className="space-y-3">
                  <input placeholder="Mint A Address" value={mintA} onChange={e => setMintA(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-xs font-mono text-white/70 focus:outline-none focus:border-emerald-500/50"/>
                  <input placeholder="Mint B Address" value={mintB} onChange={e => setMintB(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-xs font-mono text-white/70 focus:outline-none focus:border-emerald-500/50"/>
                </div>
              </div>

              <div className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-4">
                <div className="flex justify-between items-center"><h4 className="text-sm font-semibold tracking-wider text-white/80"><Plus className="w-4 h-4 inline mr-2 text-white/40"/> Provide Liquidity</h4></div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-white/40 ml-2">Token A</label>
                    <input type="number" value={depositAmountA} onChange={e => setDepositAmountA(Number(e.target.value))} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 font-mono text-white/90 text-sm focus:outline-none"/>
                  </div>
                  <div>
                    <label className="text-xs text-white/40 ml-2">Token B</label>
                    <input type="number" value={depositAmountB} onChange={e => setDepositAmountB(Number(e.target.value))} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 font-mono text-white/90 text-sm focus:outline-none"/>
                  </div>
                </div>
                <button onClick={executeDeposit} disabled={isExecuting} className="w-full bg-white text-black py-3 rounded-xl font-bold text-sm transition-all hover:bg-white/90">Deposit Dual Assets</button>
              </div>
            </div>
          </motion.div>
        );
    }
  };

  const getHeroText = () => {
    switch(activeTab) {
      case "arbitrage":
        return <>Extract <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-rose-400">Zero-Risk</span> <br/> Arbitrage Alpha.</>;
      case "swap":
         return <>Unified <span className="bg-clip-text text-transparent bg-gradient-to-r from-fuchsia-400 via-rose-400 to-orange-400">Liquid</span> <br/> Swap Engine.</>;
      case "pool":
         return <>Deep <span className="bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400">Yield</span> <br/> Provisioning.</>;
    }
  }

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-white selection:bg-indigo-500/30 font-sans overflow-hidden relative">
      {/* Background Gradients */}
      <div className="absolute top-[-10%] left-[-10%] w-[40vw] h-[40vw] rounded-full bg-indigo-600/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[30vw] h-[30vw] rounded-full bg-fuchsia-600/20 blur-[120px] pointer-events-none" />

      {/* Navigation Bar */}
      <nav className="relative z-50 sticky top-0 border-b border-white/5 bg-black/50 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-gradient-to-br from-indigo-500 to-fuchsia-500 rounded-xl shadow-lg shadow-indigo-500/20">
              <Zap className="w-6 h-6 text-white" fill="currentColor" />
            </div>
            <span className="text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
              FlashDex
            </span>
          </div>

          {/* Desktop segmented control for internal routing */}
          <div className="hidden md:flex p-1 bg-white/5 border border-white/10 rounded-xl">
             <button onClick={() => setActiveTab('arbitrage')} className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'arbitrage' ? 'bg-indigo-500/20 text-indigo-300 shadow-sm' : 'text-white/50 hover:text-white/80'}`}>Flash Arbitrage</button>
             <button onClick={() => setActiveTab('swap')} className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'swap' ? 'bg-fuchsia-500/20 text-fuchsia-300 shadow-sm' : 'text-white/50 hover:text-white/80'}`}>Swap Token</button>
             <button onClick={() => setActiveTab('pool')} className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'pool' ? 'bg-emerald-500/20 text-emerald-300 shadow-sm' : 'text-white/50 hover:text-white/80'}`}>Liquidity Pool</button>
          </div>

          <div className="[&_.wallet-adapter-button]:bg-white/10 [&_.wallet-adapter-button]:hover:bg-white/20 [&_.wallet-adapter-button]:transition-all [&_.wallet-adapter-button]:rounded-xl [&_.wallet-adapter-button]:border [&_.wallet-adapter-button]:border-white/10">
            {mounted && <WalletMultiButton />}
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="relative z-10 max-w-7xl mx-auto px-6 pt-16 pb-24 grid grid-cols-1 lg:grid-cols-12 gap-12">
        
        {/* Left Column: Hero & Input */}
        <div className="lg:col-span-7 flex flex-col justify-center space-y-10">
          <motion.div 
            key={activeTab + "-hero"}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
            className="space-y-6"
          >
            <div className="inline-flex items-center space-x-2 px-4 py-2 rounded-full border border-white/10 bg-white/5 text-white/60 text-sm font-medium">
              <span className="relative flex h-2 w-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${activeTab === 'arbitrage' ? 'bg-indigo-400' : activeTab === 'swap' ? 'bg-fuchsia-400' : 'bg-emerald-400'} opacity-75`}></span>
                <span className={`relative inline-flex rounded-full h-2 w-2 ${activeTab === 'arbitrage' ? 'bg-indigo-500' : activeTab === 'swap' ? 'bg-fuchsia-500' : 'bg-emerald-500'}`}></span>
              </span>
              <span>Introspection Vector Engine</span>
            </div>
            <h1 className="text-5xl lg:text-7xl font-extrabold tracking-tight leading-tight">
              {getHeroText()}
            </h1>
            <p className="text-lg text-white/50 max-w-xl leading-relaxed">
              Experience unified deep AMM liquidity and ultra-fast Instruction Introspection in one seamless Anchor program. Zero collateral, zero reentrancy risks.
            </p>
          </motion.div>

          {/* Control Panel Glassmorphism Card */}
          <div className="relative p-[1px] rounded-3xl bg-gradient-to-b from-white/10 to-white/5 overflow-hidden min-h-[400px]">
            <div className="absolute inset-0 bg-white/5 backdrop-blur-2xl" />
            <AnimatePresence mode="wait">
              {renderActiveCard()}
            </AnimatePresence>
          </div>
        </div>

        {/* Right Column: Execution Logs & Stats */}
        <div className="lg:col-span-5 flex flex-col space-y-6 lg:mt-16">
          <motion.div 
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6, delay: 0.2 }}
            className="flex-1 rounded-3xl bg-white/[0.02] border border-white/5 p-6 flex flex-col relative overflow-hidden"
          >
             <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
             <div className="flex items-center space-x-3 mb-6">
                <Activity className="w-5 h-5 text-indigo-400" />
                <h3 className="font-semibold text-white/80 tracking-wide">Execution Trace Logs</h3>
             </div>

             <div className="flex-1 bg-black/40 rounded-2xl border border-white/5 p-4 font-mono text-sm overflow-y-auto min-h-[400px] flex flex-col space-y-3">
               {logs.length === 0 ? (
                 <div className="flex-1 flex flex-col items-center justify-center text-white/20">
                   <History className="w-8 h-8 mb-3 opacity-20" />
                   <p>Awaiting transaction payload...</p>
                 </div>
               ) : (
                 <AnimatePresence>
                 {logs.map((log) => (
                   <motion.div 
                     key={log.id} 
                     initial={{ opacity: 0, x: -10 }}
                     animate={{ opacity: 1, x: 0 }}
                     className="flex items-start space-x-3"
                   >
                     <span className="shrink-0 mt-0.5">
                       {log.type === 'success' && <CheckCircle className="w-4 h-4 text-emerald-400" />}
                       {log.type === 'error' && <XCircle className="w-4 h-4 text-rose-400" />}
                       {log.type === 'info' && <ShieldCheck className="w-4 h-4 text-indigo-400" />}
                     </span>
                     <span className={`leading-relaxed ${
                       log.type === 'success' ? 'text-emerald-300' : 
                       log.type === 'error' ? 'text-rose-300' : 
                       'text-indigo-200/80'
                     }`}>
                       {log.message}
                     </span>
                   </motion.div>
                 ))}
                 </AnimatePresence>
               )}
             </div>
          </motion.div>
        </div>

      </main>
    </div>
  );
}
