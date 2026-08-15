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
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <h1 className="text-4xl font-bold text-gray-900">
        Stellar Testnet Wallet 🚀
      </h1>
    </div>
  );
}

export default App;