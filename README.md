# FlashDex ⚡️

A high-performance Solana unified Decentralized Exchange (DEX) and Flash Loan lending pool built with Anchor. 
This protocol allows **Deep Liquidity Sharing** wherein regular AMM swaps and integer-zero-risk flash loans originate directly from the identical protocol vaults.

Inspired by *Jupiter Lend's* cutting-edge architecture (shared pool vectorization) without sacrificing composability. Optimized specifically to provide a "production grade" and zero-reentrancy security standard for Solana DeFi.

---

## 🏗 Key Features

### 1. Unified Liquidity (AMM + Flash Loans)
In traditional EVM development, Flash loans originate from an isolated pool while the DEX operates autonomously. We merge them conceptually into one protocol - **FlashDex**.

Liquidity Providers (LPs) supply `deposit` which seamlessly serves:
* Regular CPMM `swap` trades.
* Flash loan `borrow` & `repay` arbitrage transactions.
By joining both mechanics, LPs drastically improve capital utilization and capture both swap fees *and* flash loan interest organically.

### 2. State Syncing Architecture
Instead of storing mirrored `reserve_a` and `reserve_b` constants within the main `Pool` Account state mapping (which opens up attack-vectors to "accounting drift"), FlashDex inherently accesses the direct `TokenAccount.amount` dynamically from `Vault_A` and `Vault_B`. This removes the overhead of complex state management.

### 3. Flash Loans 2.0 (Instruction Introspection)
Solana lacks native CPI callbacks due to security models against reentrancy. We implement **Instruction Introspection (`sysvar::instructions`)** to simulate callbacks safely within a localized transaction block.
1. The Arbitrageur embeds `flash_borrow` up top as Index(0).
2. Performs any intermediate arbitrage routing (e.g. via `Jupiter CPI`).
3. Embeds `flash_repay` at the final index to clear debt.

The borrow instruction explicitly preemptively halts if `flash_repay` with a tightly bound Anchor Instruction Hash (Discriminator) match isn't present in the execution layer. Any failures roll back the entire transaction context - keeping the protocol robust and insolvency-proof.

### 4. Enterprise-Grade Security
* **Strict Reentrancy Guards:** Integrates `is_flash_loaning` bool flag locking.
* **Safe Mathematics:** Forced implementation of `.checked_mul()`, `.checked_add()`, `.checked_div()` to avoid panics or arithmetic overflows.
* **Fee Routing:** Transparent `fee_bps` mapping splits between pool stakeholders.

---

## 🚀 Quick Start / Setup

### Prerequisites
- Node.js (v18+)
- Rust & Cargo
- Solana CLI
- Anchor CLI (version >=0.30+)
- TypeScript & Bankrun (For testing)

```bash
# Clone and enter the project
cd flash-dex

# Build the smart contracts
anchor build

# Test the core routing (We recommend relying on Bankrun testing for extreme 1ms lightweight mainnet forks)
pnpm test
```

## 🛠 File Structure (Day 1-4 Projection)
- `programs/flash-dex/src/lib.rs` : Anchor logic for Pool init, Swap, Deposit, Borrow, Repay.
- `tests/flash_dex.ts` : Automated extreme edge-case Bankrun test loops simulating the full Flash Loan Arbitrage lifecycle against simulated Jupiter quotes.

---

## 👨‍💻 Roadmap

#### Day 1-2: Core AMM (Completed ✅)
- Scaffold robust AMM Vault integrations and basic Initializations (`Initialize`, `Swap`, `Deposit`).
- Embed CFMM formula integrations.

#### Day 3-4: Secure Flash Routing (In Progress 🔜)
- Incorporate `flash_borrow` and `flash_repay` introspection vectors.
- Anchor Discriminator integrity checking implementation.

#### Day 5+: Testing / Front-End
- `solana-bankrun` testing flows.
- Generic TS scripts hooking onto blockchain events via `@solana/web3.js` Event Listeners.

---

*“Built to maximize composability standardizations on Solana.”*
