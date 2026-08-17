import { useEffect, useState } from "react";
import * as StellarSdk from "@stellar/stellar-sdk";
import {
  isConnected,
  setAllowed,
  getAddress,
  signTransaction,
} from "@stellar/freighter-api";


// ===============================
// STELLAR TESTNET
// ===============================

const HORIZON_URL = "https://horizon-testnet.stellar.org";

const server = new StellarSdk.Horizon.Server(HORIZON_URL);

const NETWORK = StellarSdk.Networks.TESTNET;

// ===============================
// APP
// ===============================

function App() {
  // Wallet
  const [address, setAddress] = useState("");

  // Balance
  const [balance, setBalance] = useState("0");

  // Send form
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");

  // Transaction
  const [txHash, setTxHash] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  // History
  const [transactions, setTransactions] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ==========================================
  // LOAD BALANCE
  // ==========================================

  const loadBalance = async (publicKey) => {
    try {
      const account = await server.loadAccount(publicKey);

      const nativeBalance = account.balances.find(
        (item) => item.asset_type === "native"
      );

      if (nativeBalance) {
        setBalance(nativeBalance.balance);
      } else {
        setBalance("0");
      }
    } catch (error) {
      console.error("Balance error:", error);
      setBalance("0");
    }
  };

  // ==========================================
  // LOAD TRANSACTION HISTORY
  // ==========================================

  const loadTransactionHistory = async (publicKey) => {
    try {
      setHistoryLoading(true);

      const response = await server
        .transactions()
        .forAccount(publicKey)
        .order("desc")
        .limit(20)
        .call();

      const records = response.records || [];

      const history = await Promise.all(
        records.map(async (transaction) => {
          let operations = [];

          try {
            const operationResponse = await server
              .operations()
              .forTransaction(transaction.hash)
              .call();

            operations = operationResponse.records || [];
          } catch (error) {
            console.error(
              "Could not load operations:",
              error
            );
          }

          const payment = operations.find(
            (operation) =>
              operation.type === "payment" &&
              operation.asset_type === "native"
          );

          let type = "Transaction";
          let transactionAmount = "-";
          let counterparty = "";

          if (payment) {
            if (payment.from === publicKey) {
              type = "Sent";
              transactionAmount = `-${payment.amount} XLM`;
              counterparty = payment.to;
            } else if (payment.to === publicKey) {
              type = "Received";
              transactionAmount = `+${payment.amount} XLM`;
              counterparty = payment.from;
            }
          }

          return {
            hash: transaction.hash,
            createdAt: transaction.created_at,
            successful: transaction.successful,
            type,
            amount: transactionAmount,
            counterparty,
          };
        })
      );

      setTransactions(history);
    } catch (error) {
      console.error(
        "Transaction history error:",
        error
      );

      setTransactions([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  // ==========================================
  // CONNECT FREIGHTER
  // ==========================================

  const connectWallet = async () => {
    try {
      setMessage("Connecting to Freighter...");

      const connected = await isConnected();

      if (!connected) {
        setMessage(
          "Please install/open Freighter first."
        );
        return;
      }

      await setAllowed();

      const result = await getAddress();

      const publicKey = result.address;

      if (!publicKey) {
        setMessage(
          "Could not get your Stellar address."
        );
        return;
      }

      setAddress(publicKey);

      // Load balance
      await loadBalance(publicKey);

      // Load old transactions
      await loadTransactionHistory(publicKey);

      setMessage("Wallet connected successfully.");
    } catch (error) {
      console.error("Wallet connection error:", error);

      setMessage(
        error?.message ||
          "Could not connect to Freighter."
      );
    }
  };

  // ==========================================
  // CHECK WALLET WHEN APP OPENS
  // ==========================================

  useEffect(() => {
    const checkWallet = async () => {
      try {
        const connected = await isConnected();

        if (!connected) {
          return;
        }

        const result = await getAddress();

        if (result?.address) {
          setAddress(result.address);

          await loadBalance(result.address);

          await loadTransactionHistory(
            result.address
          );
        }
      } catch (error) {
        console.error(
          "Automatic wallet check failed:",
          error
        );
      }
    };

    checkWallet();
  }, []);

  // ==========================================
  // SEND XLM
  // ==========================================

  const sendXLM = async () => {
    console.log("SEND BUTTON CLICKED");

    try {
      setMessage("");
      setTxHash("");

      // Wallet check
      if (!address) {
        setMessage(
          "Please connect your Freighter wallet first."
        );
        return;
      }

      // Recipient check
      if (!recipient.trim()) {
        setMessage(
          "Please enter the recipient address."
        );
        return;
      }

      // Amount check
      if (!amount.trim()) {
        setMessage("Please enter an amount.");
        return;
      }

      const amountNumber = Number(amount);

      if (
        !Number.isFinite(amountNumber) ||
        amountNumber <= 0
      ) {
        setMessage(
          "Please enter a valid XLM amount."
        );
        return;
      }

      // Validate Stellar address
      try {
        StellarSdk.StrKey.decodeEd25519PublicKey(
          recipient.trim()
        );
      } catch {
        setMessage(
          "Invalid Stellar recipient address."
        );
        return;
      }

      setLoading(true);

      setMessage(
        "Preparing transaction..."
      );

      // Get sender account
      const account =
        await server.loadAccount(address);

      // Build transaction
      const transaction =
        new StellarSdk.TransactionBuilder(
          account,
          {
            fee: StellarSdk.BASE_FEE,
            networkPassphrase: NETWORK,
          }
        )
          .addOperation(
            StellarSdk.Operation.payment({
              destination:
                recipient.trim(),
              asset:
                StellarSdk.Asset.native(),
              amount: amount,
            })
          )
          .setTimeout(30)
          .build();

      setMessage(
        "Please approve the transaction in Freighter..."
      );

      // Ask Freighter to sign
      const signed = await signTransaction(
        transaction.toXDR(),
        {
          networkPassphrase: NETWORK,
        }
      );

      if (signed.error) {
        throw new Error(
          signed.error.message ||
            "Transaction was rejected."
        );
      }

      const signedXdr =
        signed.signedTxXdr ||
        signed.signedTransaction;

      if (!signedXdr) {
        throw new Error(
          "No signed transaction was returned by Freighter."
        );
      }

      // Convert signed XDR back to transaction
      const signedTransaction =
        StellarSdk.TransactionBuilder.fromXDR(
          signedXdr,
          NETWORK
        );

      setMessage(
        "Submitting transaction to Stellar Testnet..."
      );

      // Submit
      const result =
        await server.submitTransaction(
          signedTransaction
        );

      // Hash
      setTxHash(result.hash);

      setMessage(
        "Transaction successful! 🎉"
      );

      // Clear amount
      setAmount("");

      // Refresh balance
      await loadBalance(address);

      // Refresh history
      await loadTransactionHistory(address);
    } catch (error) {
      console.error(
        "Transaction error:",
        error
      );

      setMessage(
        error?.message
          ? `Transaction failed: ${error.message}`
          : "Transaction failed."
      );
    } finally {
      setLoading(false);
    }
  };

  // ==========================================
  // FORMAT DATE
  // ==========================================

  const formatDate = (date) => {
    return new Date(date).toLocaleString();
  };

  // ==========================================
  // SHORT ADDRESS
  // ==========================================

  const shortAddress = address
    ? `${address.slice(
        0,
        6
      )}...${address.slice(-6)}`
    : "";

  // ==========================================
  // UI
  // ==========================================

  return (
  <div className="min-h-screen bg-slate-950 px-4 py-8 text-white">
    <div className="mx-auto max-w-5xl">

      {/* Header */}
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            ✦ Stellar Wallet
          </h1>

          <p className="mt-2 text-sm text-slate-400">
            Secure Stellar Testnet wallet
          </p>
        </div>

        <div className="w-fit rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm text-amber-300">
          ● TESTNET
        </div>
      </header>

      {!address ? (
        /* Connect */
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl sm:p-12">

          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-white text-3xl text-slate-900 shadow-lg">
            ✦
          </div>

          <h2 className="text-2xl font-bold">
            Connect your wallet
          </h2>

          <p className="mx-auto mt-3 max-w-md text-slate-400">
            Connect Freighter to view your XLM balance,
            send Testnet XLM and view your transaction history.
          </p>

          <button
            onClick={connectWallet}
            className="mt-8 rounded-xl bg-indigo-500 px-7 py-3 font-semibold transition hover:bg-indigo-400 active:scale-95"
          >
            Connect Freighter
          </button>
        </div>
      ) : (

        <div className="grid gap-6 lg:grid-cols-3">

          {/* Main column */}
          <div className="space-y-6 lg:col-span-2">

            {/* Wallet */}
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-xl">

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">
                    Connected wallet
                  </p>

                  <p className="mt-1 font-semibold">
                    {shortAddress}
                  </p>
                </div>

                <div className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-400">
                  Connected
                </div>
              </div>

              <div className="mt-4 break-all rounded-xl bg-slate-950 p-3 text-xs text-slate-400">
                {address}
              </div>
            </div>

            {/* Balance */}
            <div className="rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-600 p-6 shadow-xl">

              <p className="text-sm text-indigo-100">
                Available balance
              </p>

              <div className="mt-3 flex items-end gap-3">
                <span className="text-4xl font-bold sm:text-5xl">
                  {balance}
                </span>

                <span className="mb-1 text-lg font-medium text-indigo-100">
                  XLM
                </span>
              </div>

              <p className="mt-3 text-sm text-indigo-100">
                Stellar Testnet
              </p>
            </div>

            {/* Send */}
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-xl">

              <h2 className="text-xl font-bold">
                Send XLM
              </h2>

              <p className="mt-1 text-sm text-slate-400">
                Send Testnet XLM to another Stellar account.
              </p>

              <div className="mt-6 space-y-5">

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    Recipient address
                  </label>

                  <input
                    type="text"
                    placeholder="G..."
                    value={recipient}
                    onChange={(e) =>
                      setRecipient(e.target.value)
                    }
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none transition placeholder:text-slate-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">
                    Amount
                  </label>

                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      step="0.0000001"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) =>
                        setAmount(e.target.value)
                      }
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 pr-16 text-sm outline-none transition placeholder:text-slate-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                    />

                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">
                      XLM
                    </span>
                  </div>
                </div>

                <button
                  onClick={sendXLM}
                  disabled={loading}
                  className="w-full rounded-xl bg-indigo-500 py-3 font-semibold transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.99]"
                >
                  {loading
                    ? "Processing..."
                    : "Send XLM"}
                </button>

              </div>
            </div>

            {/* Message */}
            {message && (
              <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-sm text-slate-300">
                {message}
              </div>
            )}

            {/* Transaction result */}
            {txHash && (
              <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/10 p-6">

                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20">
                    ✓
                  </div>

                  <div>
                    <h2 className="font-bold text-emerald-400">
                      Transaction successful
                    </h2>

                    <p className="text-sm text-slate-400">
                      Your transaction was submitted to Testnet.
                    </p>
                  </div>
                </div>

                <div className="mt-5 rounded-xl bg-slate-950 p-4">
                  <p className="text-xs text-slate-500">
                    Transaction hash
                  </p>

                  <p className="mt-2 break-all text-xs text-slate-300">
                    {txHash}
                  </p>
                </div>

                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-block text-sm font-semibold text-indigo-400 hover:text-indigo-300"
                >
                  View on Stellar Explorer →
                </a>
              </div>
            )}
          </div>

          {/* History */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-xl lg:col-span-1">

            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">
                  History
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  Recent transactions
                </p>
              </div>

              <button
                onClick={() =>
                  loadTransactionHistory(address)
                }
                disabled={historyLoading}
                className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-slate-700 disabled:opacity-50"
              >
                {historyLoading ? "..." : "Refresh"}
              </button>
            </div>

            <div className="mt-6 space-y-3">

              {historyLoading &&
              transactions.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">
                  Loading history...
                </p>
              ) : transactions.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">
                  No transactions found.
                </p>
              ) : (
                transactions.map((transaction) => (
                  <div
                    key={transaction.hash}
                    className="rounded-2xl border border-slate-800 bg-slate-950 p-4"
                  >

                    <div className="flex items-start justify-between gap-3">

                      <div>
                        <p
                          className={`font-semibold ${
                            transaction.type === "Sent"
                              ? "text-red-400"
                              : transaction.type === "Received"
                              ? "text-emerald-400"
                              : "text-slate-300"
                          }`}
                        >
                          {transaction.type}
                        </p>

                        <p className="mt-1 text-lg font-bold">
                          {transaction.amount}
                        </p>
                      </div>

                      <span className="text-xs text-emerald-400">
                        {transaction.successful
                          ? "✓ Success"
                          : "✕ Failed"}
                      </span>

                    </div>

                    <p className="mt-3 text-xs text-slate-500">
                      {formatDate(
                        transaction.createdAt
                      )}
                    </p>

                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${transaction.hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-block text-xs font-medium text-indigo-400 hover:text-indigo-300"
                    >
                      View transaction →
                    </a>

                  </div>
                ))
              )}

            </div>
          </div>

        </div>
      )}

    </div>
  </div>
);
}
export default App;