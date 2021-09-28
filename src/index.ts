require('dotenv').config();
import cliProgress from 'cli-progress';
import got from 'got';
import { clusterApiUrl, Connection, PublicKey } from '@solana/web3.js';
import parallelLimit from 'async/parallelLimit';

import async from 'async';
import { Data, Metadata } from './metaplex/classes';
import { METADATA_PROGRAM_ID } from './metaplex/constants';
import { decodeMetadata } from './metaplex/metadata';
import { appendToFile } from './handlers/file.system';
const METADATA_PROGRAM_PK = new PublicKey(METADATA_PROGRAM_ID);

interface MintData {
  imageUri?: string;
  mintWalletAddress: string;
  nftData: Data;
  tokenMetadata: Metadata;
  totalSupply: number;
}
interface CollectionInfo {
  mintWalletAddress: string;
  totalSupply: number;
}

//interface to hold the rety data
interface RetryMint {
  imageUri?: string;
  mintAddress: string;
  name: string;
}
const retries: RetryMint[] = [];
const mintTokenIds = [];
const mints: MintData[] = [];

const progressBar = new cliProgress.SingleBar(
  {},
  cliProgress.Presets.shades_classic
);
// batch all accountData to loop over with aysnc
const metaDataFetcher = [];
let collectionName: string = '';
// get metadat given Token Account
async function retrieveMetadata(
  accountData: any,
  decoded: boolean,
  record: any,
  writeToFile: boolean,
  MINT_LIST: boolean
) {
  //TODO RETRY mechanism on failed needs fixed
  try {
    // if already decoded URI, use seperate function to retry data logic
    let tokenMetadata: any;
    if (!decoded) {
      tokenMetadata = decodeMetadata(accountData);
    } else {
      tokenMetadata = { data: { uri: accountData } };
    }
    // flag to just get the token mintList
    if (MINT_LIST) {
      // console.log(' MINT ', tokenMetadata.mint);
      // token mint is in decoded tokenMetaData.mint
      return {
        nftData: null,
        tokenMetadata,
        status: { success: true },
        writeToFile: writeToFile,
      };
    } else {
      //check for valid url before passing to got, add to retires array if invalid URL
      if (tokenMetadata.data.uri.indexOf('https://') === -1) {
        console.log(
          ' invalid image URI, skipping adding to retries ->>> ' +
            tokenMetadata.data.name
        );
        const retryData = {
          name: tokenMetadata.data.name,
          uri: tokenMetadata.data.uri.toString(),
          mintAddress: tokenMetadata.mint,
        };
        retries.push(retryData);
        return {
          status: { success: false },
        };
      } else {
        console.log(' fetching ', tokenMetadata.data.name);
        const nftInfoResponse = await got(tokenMetadata.data.uri);

        // this fails, need to check for valid JSON
        return {
          nftData: JSON.parse(nftInfoResponse.body),
          tokenMetadata,
          status: { success: true },
          writeToFile: writeToFile,
        };
      }
    }
  } catch (error) {
    console.log(record, error);
    return {
      status: { success: false },
    };
  }
}

async function tryToShowOverallMetadataInfo(accountData) {
  // when displaying data dont write duplicate first fetch to file
  const { nftData } = await retrieveMetadata(
    accountData,
    false,
    null,
    false,
    false
  );
  collectionName = nftData.collection?.name || '';
  console.log(`Name: ${nftData.name || ''}`);
  console.log(`Symbol: ${nftData.symbol || ''}`);
  console.log(`Collection.Name: ${collectionName}`);
  console.log(`Collection.Family: ${nftData.collection?.family || ''}`);
}

// begin scan
(async function () {
  console.log('mint list = ', process.env.MINT_LIST);
  // add flag to skip getting full meta data and only decode mintList
  const MINT_LIST = Boolean(process.env.MINT_LIST);

  dataScrape(MINT_LIST);
})();

// function to fetch data, progress bar, save to file and log retries
async function fetchData(
  accountData: Buffer,
  collectionInfo: CollectionInfo,
  callback: () => {},
  MINT_LIST: boolean
): Promise<void> {
  try {
    // fetch metadata for token
    const { nftData, tokenMetadata, status } = await retrieveMetadata(
      accountData,
      false,
      null,
      true,
      MINT_LIST
    );
    // if data is fetched, parseto mintData and add to array
    //TODO This needs reworked, currently doesn't process retries
    if (status.success) {
      const mintData = {
        imageUri: nftData?.image,
        mintWalletAddress: collectionInfo.mintWalletAddress,
        nftData,
        tokenMetadata,
        totalSupply: collectionInfo.totalSupply,
      };
      const writeToConsole = true;
      if (writeToConsole) {
        console.log(' writing ', tokenMetadata.mint);
        console.log(' writing ', mintData);
      }
      // const name =
      //   collectionName.toUpperCase().split(' ').join('_') +
      //   '_' +
      //   tokenMetadata.mint;
      mintTokenIds.push(name);
      mints.push(mintData);
      await appendToFile(
        `mint-list:${collectionInfo.mintWalletAddress}`,
        tokenMetadata.mint
      );
      // flag to only get mintList and not full metaData
      if (!MINT_LIST) {
        appendToFile(
          `mint-token-ids:${collectionInfo.mintWalletAddress}`,
          mintData
        );
      }

      // callback to tell async process next item
      callback();
    }

    progressBar.increment();
  } catch (error) {
    console.log('errrr ', error);
  }
}

export async function dataScrape(MINT_LIST: boolean) {
  if (process.argv.length < 3) {
    console.error('please provide a wallet address as an argument');
    return;
  }

  //TODO verify valid SOL address
  const mintWalletAddress = process.argv.slice(2).shift();

  const NETWORK = 'mainnet-beta';
  const conn = new Connection(clusterApiUrl(NETWORK), 'confirmed');
  console.log(`--->> ${NETWORK} connection established`);
  // get program accounts, this is what we can batch for parallelizaiton
  const response = await conn.getProgramAccounts(METADATA_PROGRAM_PK, {
    filters: [
      {
        memcmp: {
          offset: 326,
          bytes: mintWalletAddress,
        },
      },
    ],
  });
  const totalSupply = response.length;
  console.log('Mint Wallet Address: ', mintWalletAddress);
  console.log('Total Supply: ', totalSupply);

  // quickly show metadata from first record
  const firstRecord = response[0];
  await tryToShowOverallMetadataInfo(firstRecord.account.data);

  progressBar.start(totalSupply, 0);

  const recordData = Object.values(response);
  const collectionInfo = {
    mintWalletAddress,
    totalSupply,
  };
  for (let x = 0; x < recordData.length; x++) {
    if (MINT_LIST) {
      await fetchData(
        recordData[x].account.data,
        collectionInfo,
        () => null,
        MINT_LIST
      );
    } else {
      metaDataFetcher.push(function (callback: () => {}) {
        return fetchData(
          recordData[x].account.data,
          collectionInfo,
          callback,
          MINT_LIST
        );
      });
    }
  }
  console.log(
    '----->> data retrieved ',
    metaDataFetcher.length,
    ' records to fetch '
  );

  if (!totalSupply) {
    progressBar.stop();
    return;
  }

  // set thread count based off cpus, 2 is baseline laptop
  // beefier machine could go higher without data loss
  const THREAD_COUNT = 1;
  console.log(
    ` | ${THREAD_COUNT} threads processing | ${metaDataFetcher.length} requests`
  );
  try {
    parallelLimit(
      async.reflectAll(metaDataFetcher),
      THREAD_COUNT,
      (err: any, results: any) => {
        console.log('Data fetch complete');
      }
    );
  } catch (error) {
    console.log(error);
  }
}
