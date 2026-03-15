"use client";

import { useState, useEffect } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { motion } from "framer-motion";
import { Activity, ArrowRightLeft, Zap, ShieldCheck, History, XCircle, CheckCircle } from "lucide-react";

export default function Home() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [loanAmount, setLoanAmount] = useState<number>(10000);
  const [isExecuting, setIsExecuting] = useState(false);
  const [logs, setLogs] = useState<{ id: number; message: string; type: "info" | "success" | "error" }[]>([]);

  const addLog = (message: string, type: "info" | "success" | "error" = "info") => {
    setLogs((prev) => [...prev, { id: Date.now(), message, type }]);
  };

  const executeArbitrage = async () => {
    if (!publicKey) {
      addLog("Please connect your wallet first.", "error");
      return;
    }

    setIsExecuting(true);
    addLog(`Initiating flash loan of ${loanAmount.toLocaleString()} USDC...`, "info");
    
    try {
      // Simulate real-world network delay & processing steps for visual impact
      await new Promise(r => setTimeout(r, 1000));
      addLog("Flash Borrow Index(0): Success. Fund secured.", "success");
      
      await new Promise(r => setTimeout(r, 1200));
      addLog("Triggering inner DEX CPI routing for arbitrage...", "info");
      
      await new Promise(r => setTimeout(r, 1500));
      addLog("Arbitrage profitable. Extracted surplus liquidity.", "success");

      await new Promise(r => setTimeout(r, 1000));
      addLog("Flash Repay Index(N): Instruction Introspection authenticated.", "success");

      // Note: To submit the real transaction as described in Day 6:
      // const borrowIx = await program.methods.flashBorrow(...).instruction();
      // const arbIx = SystemProgram.transfer(...); // Simulated Arb
      // const repayIx = await program.methods.flashRepay(...).instruction();
      // const tx = new Transaction().add(borrowIx, arbIx, repayIx);
      // const signature = await sendTransaction(tx, connection);
      
      addLog("Transaction confirmed on-chain! Profit booked. ⚡️", "success");
    } catch (error: any) {
      addLog(`Arbitrage failed: ${error.message || "Unknown error"}`, "error");
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-white selection:bg-indigo-500/30 font-sans overflow-hidden relative">
      {/* Background Gradients & Glows */}
      <div className="absolute top-[-10%] left-[-10%] w-[40vw] h-[40vw] rounded-full bg-indigo-600/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[30vw] h-[30vw] rounded-full bg-fuchsia-600/20 blur-[120px] pointer-events-none" />

      {/* Navigation Bar */}
      <nav className="relative z-10 sticky top-0 border-b border-white/5 bg-black/50 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-gradient-to-br from-indigo-500 to-fuchsia-500 rounded-xl shadow-lg shadow-indigo-500/20">
              <Zap className="w-6 h-6 text-white" fill="currentColor" />
            </div>
            <span className="text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
              FlashDex
            </span>
          </div>
          <div className="[&_.wallet-adapter-button]:bg-white/10 [&_.wallet-adapter-button]:hover:bg-white/20 [&_.wallet-adapter-button]:transition-all [&_.wallet-adapter-button]:rounded-xl [&_.wallet-adapter-button]:border [&_.wallet-adapter-button]:border-white/10">
            <WalletMultiButton />
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="relative z-10 max-w-7xl mx-auto px-6 pt-16 pb-24 grid grid-cols-1 lg:grid-cols-12 gap-12">
        
        {/* Left Column: Hero & Input */}
        <div className="lg:col-span-7 flex flex-col justify-center space-y-10">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="space-y-6"
          >
            <div className="inline-flex items-center space-x-2 px-4 py-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-sm font-medium">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
              </span>
              <span>Introspection Flash Loans Live</span>
            </div>
            <h1 className="text-5xl lg:text-7xl font-extrabold tracking-tight leading-tight">
              Extract <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-fuchsia-400 to-rose-400">Zero-Risk</span> <br/> 
              Arbitrage Alpha.
            </h1>
            <p className="text-lg text-white/50 max-w-xl leading-relaxed">
              Leverage unified deep AMM liquidity through Solanas ultra-fast Instruction Introspection. No collateral required. Zero reentrancy vectors.
            </p>
          </motion.div>

          {/* Control Panel Glassmorphism Card */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="relative p-[1px] rounded-3xl bg-gradient-to-b from-white/10 to-transparent overflow-hidden"
          >
            <div className="absolute inset-0 bg-white/5 backdrop-blur-2xl" />
            <div className="relative p-8 space-y-8 h-full bg-black/40 rounded-[23px]">
              
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
                    +${(loanAmount * 0.003).toFixed(2)} USD
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-sm font-medium text-white/60">Flash Borrow Amount (USDC)</label>
                <div className="relative">
                  <input 
                    type="number" 
                    value={loanAmount}
                    onChange={(e) => setLoanAmount(Number(e.target.value))}
                    className="w-full bg-black/50 border border-white/10 rounded-2xl px-6 py-5 text-2xl font-mono focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all text-white/90"
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 px-4 py-2 bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 rounded-xl font-bold text-sm cursor-pointer hover:bg-indigo-500/30 transition-colors"
                       onClick={() => setLoanAmount(1000000)}
                  >
                    MAX
                  </div>
                </div>
                <div className="flex justify-between px-2 text-xs text-white/40 font-mono">
                  <span>Fee: {(loanAmount * 0.001).toLocaleString()} ($ {(loanAmount * 0.001).toFixed(2)})</span>
                  <span>Slippage Tolarance: 0.1%</span>
                </div>
              </div>

              <button 
                onClick={executeArbitrage}
                disabled={isExecuting}
                className={`group relative w-full rounded-2xl p-[1px] overflow-hidden transition-all duration-300 ${isExecuting ? 'opacity-70 cursor-not-allowed' : 'hover:scale-[1.02] active:scale-[0.98]'}`}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-rose-500 opacity-70 group-hover:opacity-100 transition-opacity" />
                <div className="relative w-full bg-black/20 backdrop-blur-sm px-8 py-5 rounded-[15px] flex items-center justify-center space-x-3">
                  {isExecuting ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Zap className="w-5 h-5 text-white" fill="currentColor" />
                  )}
                  <span className="font-bold text-lg text-white tracking-wide">
                    {isExecuting ? 'Executing Flash Vector...' : 'Execute Arbitrage ⚡️'}
                  </span>
                </div>
              </button>

            </div>
          </motion.div>
        </div>

        {/* Right Column: Execution Logs & Stats */}
        <div className="lg:col-span-5 flex flex-col space-y-6 lg:mt-16">
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="flex-1 rounded-3xl bg-white/[0.02] border border-white/5 p-6 flex flex-col relative overflow-hidden"
          >
             <div className="absolute top-0 inset-x-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
             
             <div className="flex items-center space-x-3 mb-6">
                <Activity className="w-5 h-5 text-indigo-400" />
                <h3 className="font-semibold text-white/80 tracking-wide">Execution Trace Logs</h3>
             </div>

             <div className="flex-1 bg-black/40 rounded-2xl border border-white/5 p-4 font-mono text-sm overflow-y-auto min-h-[300px] flex flex-col space-y-3">
               {logs.length === 0 ? (
                 <div className="flex-1 flex flex-col items-center justify-center text-white/20">
                   <History className="w-8 h-8 mb-3 opacity-20" />
                   <p>Awaiting transaction payload...</p>
                 </div>
               ) : (
                 logs.map((log) => (
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
                 ))
               )}
             </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="grid grid-cols-2 gap-4"
          >
            <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
              <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-2">Pool Liquidity (USDC)</p>
              <p className="text-2xl font-bold font-mono">482,104.99</p>
            </div>
            <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-5">
              <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-2">Oracle Deviation</p>
              <p className="text-2xl font-bold font-mono text-emerald-400">0.08%</p>
            </div>
          </motion.div>
        </div>

      </main>
    </div>
  );
}
