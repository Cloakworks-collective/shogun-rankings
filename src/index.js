// Import required modules
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import cron from 'node-cron';
import 'dotenv/config';


// Constants
const GRAPHQL_URL = 'https://aptos-testnet.nodit.io/vgXA51EJgKrO8utPGXnC1-d3~So81-a5/v1/graphql';
// const SERVICE_ACCOUNT_PATH = './key.json';
const METADATA_DOC_ID = 'transactions';
const WARLORDS_CONTRACT = '0xc7c5e95331b975a16f0f14982506d8df7fd42bfdae0a01d510f8ebeab69c8db7';
const MIN_TRANSACTION_VERSION = 6136285815;

const serviceAccount = {
  'type': 'service_account',
  'project_id': 'warlords-de0c9',
  'private_key_id': process.env.FIREBASE_ADMIN_PRIVATE_KEY_ID,
  // See: https://stackoverflow.com/a/50376092/3403247.
  'private_key': (process.env.FIREBASE_ADMIN_PRIVATE_KEY).replace(/\\n/g, '\n'),
  'client_email': process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
  'client_id': process.env.FIREBASE_ADMIN_CLIENT_ID,
  'auth_uri': 'https://accounts.google.com/o/oauth2/auth',
  'token_uri': 'https://oauth2.googleapis.com/token',
  'auth_provider_x509_cert_url': process.env.FIREBASE_ADMIN_AUTH_PROVIDER_X509_CERT_URL,
  'client_x509_cert_url': process.env.FIREBASE_ADMIN_CLIENT_X509_CERT_URL,
}

// Initialize Firebase
async function initializeFirebase() {
  // Check if Firebase app is already initialized
  if (getApps().length === 0) {
    try {
      initializeApp({ credential: cert(serviceAccount) });
      console.log('Firebase initialized successfully');
    } catch (error) {
      console.error('Error initializing Firebase:', error);
      throw error; // Rethrow the error to be caught in the main function
    }
  } else {
    console.log('Firebase already initialized');
  }
  return getFirestore();
}

// Firestore Operations
async function getLastProcessedTransaction(db) {
    const doc = await db.collection('metadata').doc(METADATA_DOC_ID).get();
    if (doc.exists) {
      return doc.data().last_transaction_processed;
    } else {
      console.error('Metadata document not found');
      return MIN_TRANSACTION_VERSION;
    }
}

async function updateLastProcessedTransaction(db, transactionNumber) {
  try {
    await db.collection('metadata').doc(METADATA_DOC_ID).set({
      last_transaction_processed: transactionNumber
    }, { merge: true });
    console.log(`Updated last processed transaction to ${transactionNumber}`);
  } catch (error) {
    console.error('Error updating last processed transaction:', error);
  }
}

async function upsertPlayer(db, player) {
  try {
    await db.collection('players').doc(player.address).set(player, { merge: true });
  } catch (error) {
    console.error('Error upserting player:', error);
  }
}

async function getAllPlayers(db) {
  try {
    const snapshot = await db.collection('players').get();
    return snapshot.docs.map(doc => doc.data());
  } catch (error) {
    console.error('Error getting all players:', error);
    return [];
  }
}

// GraphQL Operations
async function fetchGraphQL(query, variables) {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });

  const responseBody = await response.json();
  if (responseBody.errors) {
    console.error('GraphQL Errors:', responseBody.errors);
    throw new Error('Failed to fetch data from GraphQL');
  }

  return responseBody.data;
}

async function getTransactions(account_address, limit = 100) {
  const query = `
    query TxVersionQuery($account_address: String!, $limit: Int!) {  
      account_transactions(  
        offset: 0  
        limit: $limit  
        where: { account_address: {_eq: $account_address} }  
        order_by: { transaction_version: desc }
      ) {  
        transaction_version  
      }  
    }`;

  const data = await fetchGraphQL(query, { account_address, limit });
  return data.account_transactions;
}

async function getEvents(minVersion, maxVersion) {
  const query = `
    query EventQuery($minVersion: bigint!, $maxVersion: bigint!) {
      events(
        where: {
          transaction_version: { _gte: $minVersion, _lte: $maxVersion }
          type: { _eq: "0xc7c5e95331b975a16f0f14982506d8df7fd42bfdae0a01d510f8ebeab69c8db7::warlords::AttackEvent" }
        }
        order_by: { transaction_version: asc }
      ) {
        transaction_version
        account_address
        creation_number
        event_index
        type
        data
      }
    }`;

  const data = await fetchGraphQL(query, { minVersion, maxVersion });
  return data.events;
}


// Helper functions
function getHighestTransactionVersion(transactions) {
  if (!transactions || transactions.length === 0) {
    return MIN_TRANSACTION_VERSION;
  }
  
  return Math.max(...transactions.map(tx => tx.transaction_version));
}

// Main execution - update rankings
async function update_points() {
  const db = await initializeFirebase();

  // get all transactions
  const transactions = await getTransactions(WARLORDS_CONTRACT, 50);
  const latestTx = getHighestTransactionVersion(transactions);

  // Get the last processed transaction
  const lastProcessedTx = await getLastProcessedTransaction(db);

  // Update the last processed transaction
  if (latestTx > lastProcessedTx) {
    const leastNewTransaction = lastProcessedTx + 1;
    const events = await getEvents(leastNewTransaction, latestTx);
    // Process events here
    for (const event of events) {
      const event_data = event.data;
      const player = {
        name: event_data.attaker_name,
        address: event_data.attacker,
        points: event_data.attacker_points,
      };
      console.log('Upserting player:', player);
      await upsertPlayer(db, player);
      await updateLastProcessedTransaction(db, latestTx);
    }
  }

}

//call update points every 1 minute
cron.schedule('* * * * *', () => {
  update_points();
});
