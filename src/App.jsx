import { useState } from "react";
import {
  isConnected,
  requestAccess,
  signTransaction,
} from "@stellar/freighter-api";
import * as StellarSdk from "@stellar/stellar-sdk";
import "./App.css";

const server = new StellarSdk.Horizon.Server(
  "https://horizon-testnet.stellar.org"
);

function App() {
  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState("");
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("");
  const [transactions, setTransactions] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // =========================
  // CONNECT WALLET
  // =========================

  const connectWallet = async () => {
    try {
      setStatus("Connecting to Freighter...");

      const connected = await isConnected();

      if (!connected) {
        setStatus("Please install and open Freighter.");
        return;
      }

      const access = await requestAccess();

      if (access.error) {
        console.error(access.error);
        setStatus("Wallet connection failed.");
        return;
      }

      const publicKey = access.address;

      if (!publicKey) {
        setStatus("Could not get wallet address.");
        return;
      }

      setAddress(publicKey);
      setStatus("Wallet connected!");

      await getBalance(publicKey);
      await getTransactionHistory(publicKey);
    } catch (error) {
      console.error("Wallet connection error:", error);
      setStatus("Failed to connect wallet.");
    }
  };

  // =========================
  // GET BALANCE
  // =========================

  const getBalance = async (publicKey) => {
    try {
      const account = await server
        .accounts()
        .accountId(publicKey)
        .call();

      const nativeBalance = account.balances.find(
        (item) => item.asset_type === "native"
      );

      setBalance(nativeBalance ? nativeBalance.balance : "0");
    } catch (error) {
      console.error("Balance error:", error);
      setBalance("Unable to load balance");
    }
  };

  // =========================
  // GET TRANSACTION HISTORY
  // =========================

  const getTransactionHistory = async (publicKey) => {
    if (!publicKey) {
      return;
    }

    setLoadingHistory(true);

    try {
      const { records } = await server
        .payments()
        .forAccount(publicKey)
        .order("desc")
        .limit(10)
        .call();

      const mappedTransactions = records.map((tx) => ({
        id: tx.id || tx.paging_token,
        type: tx.type || "payment",
        amount: tx.amount || "0",
        from: tx.from || "",
        to: tx.to || "",
        created_at: tx.created_at || "",
        transaction_hash: tx.transaction_hash || "",
      }));

      setTransactions(mappedTransactions);
    } catch (error) {
      console.error("Transaction history error:", error);
      setTransactions([]);
      setStatus("Unable to load transaction history.");
    } finally {
      setLoadingHistory(false);
    }
  };

  // =========================
  // REFRESH HISTORY
  // =========================

  const fetchTransactions = async () => {
    if (!address) {
      setStatus("Connect your wallet first.");
      return;
    }

    await getTransactionHistory(address);
  };

  // =========================
  // SEND XLM
  // =========================

  const sendXLM = async () => {
    try {
      if (!address) {
        setStatus("Connect your wallet first.");
        return;
      }

      if (!destination || !amount) {
        setStatus("Enter destination address and amount.");
        return;
      }

      setStatus("Preparing transaction...");

      const account = await server.loadAccount(address);

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.TESTNET,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: destination,
            asset: StellarSdk.Asset.native(),
            amount: amount,
          })
        )
        .setTimeout(180)
        .build();

      const signedTransaction = await signTransaction(
        transaction.toXDR(),
        {
          networkPassphrase: StellarSdk.Networks.TESTNET,
        }
      );

      if (signedTransaction.error) {
        console.error(signedTransaction.error);
        setStatus("Transaction signing failed.");
        return;
      }

      const tx = StellarSdk.TransactionBuilder.fromXDR(
        signedTransaction.signedTxXdr,
        StellarSdk.Networks.TESTNET
      );

      setStatus("Submitting transaction...");

      const result = await server.submitTransaction(tx);

      if (result.hash) {
        setStatus(
          `Transaction successful! Hash: ${result.hash}`
        );

        setDestination("");
        setAmount("");

        await getBalance(address);

        setTimeout(() => {
          getTransactionHistory(address);
        }, 3000);
      } else {
        setStatus("Transaction submitted, but no hash was returned.");
      }
    } catch (error) {
      console.error("Transaction error:", error);

      setStatus(
        `Transaction failed: ${
          error.message || "Unknown error"
        }`
      );
    }
  };

  // =========================
  // COPY WALLET ADDRESS
  // =========================

  const copyAddress = async () => {
    if (!address) {
      return;
    }

    try {
      await navigator.clipboard.writeText(address);
      setStatus("Wallet address copied!");
    } catch (error) {
      console.error(error);
      setStatus("Could not copy address.");
    }
  };

  // =========================
  // UI
  // =========================

  return (
    <div className="app">

      {/* WALLET */}

      <div className="wallet-card">

        <h1>Stellar Wallet</h1>

        <button onClick={connectWallet}>
          {address ? "Reconnect Wallet" : "Connect Wallet"}
        </button>

        <p className="network-label">
          🟢 Stellar Testnet
        </p>

        {address && (
          <>
            <p>
              <strong>Address:</strong>{" "}
              {address.slice(0, 8)}...
              {address.slice(-8)}
            </p>

            <p>
              <strong>Balance:</strong>{" "}
              {balance || "0"} XLM
            </p>
          </>
        )}

      </div>


      {/* RECEIVE XLM */}

      {address && (
        <div className="receive-section">

          <h2>📥 Receive XLM</h2>

          <p>
            Share this address to receive XLM:
          </p>

          <div className="address-box">

            <span>
              {address.slice(0, 8)}...
              {address.slice(-8)}
            </span>

            <button onClick={copyAddress}>
              📋 Copy Address
            </button>

          </div>

        </div>
      )}


      {/* SEND XLM */}

      <div className="send-card">

        <h2>Send XLM</h2>

        <input
          type="text"
          placeholder="Destination address"
          value={destination}
          onChange={(e) =>
            setDestination(e.target.value)
          }
        />

        <input
          type="number"
          step="0.000001"
          placeholder="Amount"
          value={amount}
          onChange={(e) =>
            setAmount(e.target.value)
          }
        />

        <button onClick={sendXLM}>
          Send XLM
        </button>

        {status && (
          <p className="status">
            {status}
          </p>
        )}

      </div>


      {/* TRANSACTION HISTORY */}

      <div className="transaction-section">

        <div className="history-header">

          <h2>📜 Transaction History</h2>

          <button
            onClick={fetchTransactions}
            disabled={loadingHistory}
          >
            {loadingHistory
              ? "Loading..."
              : "🔄 Refresh"}
          </button>

        </div>


        {!address ? (
          <p>
            Connect your wallet to view transactions.
          </p>
        ) : loadingHistory ? (
          <p>
            Loading transactions...
          </p>
        ) : transactions.length === 0 ? (
          <p>
            No transactions found.
          </p>
        ) : (

          <div className="transaction-list">

            {transactions.map((tx) => (

              <div
                className="transaction-card"
                key={tx.id}
              >

                <p>
                  <strong>Type:</strong>{" "}
                  {tx.type === "payment"
                    ? "💸 Payment"
                    : tx.type}
                </p>

                <p>
                  <strong>Amount:</strong>{" "}
                  {tx.amount
                    ? `${tx.amount} XLM`
                    : "—"}
                </p>

                <p>
                  <strong>From:</strong>{" "}
                  {tx.from
                    ? `${tx.from.slice(
                        0,
                        6
                      )}...${tx.from.slice(-6)}`
                    : "—"}
                </p>

                <p>
                  <strong>To:</strong>{" "}
                  {tx.to
                    ? `${tx.to.slice(
                        0,
                        6
                      )}...${tx.to.slice(-6)}`
                    : "—"}
                </p>

                <p>
                  <strong>Date:</strong>{" "}
                  {tx.created_at
                    ? new Date(
                        tx.created_at
                      ).toLocaleString()
                    : "—"}
                </p>

                {tx.transaction_hash && (
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${tx.transaction_hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    🔗 View on Stellar Explorer
                  </a>
                )}

              </div>

            ))}

          </div>

        )}

      </div>

    </div>
  );
}

export default App;