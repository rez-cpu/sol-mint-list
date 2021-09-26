import cliProgress from 'cli-progress';
import got from 'got';
import { clusterApiUrl, Connection, PublicKey } from '@solana/web3.js';

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

//interface to hold the rety data
interface RetryMint {
  imageUri?: string;
  mintAddress: string;
  name: string;
}
const retries: RetryMint[] = [];
const mintTokenIds = [];
const mints: MintData[] = [];

//Sample Decoded MetaDAta
// Metadata {
//   key: 4,
//   updateAuthority: 'CeS4fWuRz44kUf5aHJZW62LD8GJkPabLsChA5Zn2rLiS',
//   mint: 'GVBNcknDgx6uXE3YzpTMFGXhPJeGn6wEKH3GMU2DJSZf',
//   data: Data {
//     name: 'Galactic Gecko #8788',
//     symbol: 'GGSG',
//     uri: 'https://arweave.net/_y92_wJiqWGztTqJbBvNC80ZHGEXbrP6eNcyB9DTw2U',
//     sellerFeeBasisPoints: 500,
//     creators: [ [Creator], [Creator], [Creator], [Creator], [Creator] ]
//   },
//   primarySaleHappened: 1,
//   isMutable: 1,
//   editionNonce: undefined
// }
// get metadat given Token Account
async function retrieveMetadata(accountData: any) {
  const tokenMetadata = decodeMetadata(accountData);
  // console.log(' ---->> ', tokenMetadata);
  //check for valid url before passing to got, add to retires array if invalid URL
  if (tokenMetadata.data.uri.indexOf('https://arweave.net/') === -1) {
    console.log(
      ' invalid image URI, skipping adding to retries ->>> ' +
        tokenMetadata.data.name
    );
    const retryData = {
      name: tokenMetadata.data.name,
      imageUri: tokenMetadata.data.uri.toString(),
      mintAddress: tokenMetadata.mint,
    };
    retries.push(retryData);
    return {
      status: { success: false },
    };
  } else {
    const nftInfoResponse = await got(tokenMetadata.data.uri);
    return {
      nftData: JSON.parse(nftInfoResponse.body),
      tokenMetadata,
      status: { success: true },
    };
  }
}
async function tryToShowOverallMetadataInfo(accountData) {
  const { nftData } = await retrieveMetadata(accountData);
  console.log(`Name: ${nftData.name || ''}`);
  console.log(`Symbol: ${nftData.symbol || ''}`);
  console.log(`Collection.Name: ${nftData.collection?.name || ''}`);
  console.log(`Collection.Family: ${nftData.collection?.family || ''}`);
}

(async function () {
  if (process.argv.length < 3) {
    console.error('please provide a wallet address as an argument');
    return;
  }

  const mintWalletAddress = process.argv.slice(2).shift();

  const conn = new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');
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

  const progressBar = new cliProgress.SingleBar(
    {},
    cliProgress.Presets.shades_classic
  );

  progressBar.start(totalSupply, 0);

  if (!totalSupply) {
    progressBar.stop();
    return;
  }

  for (const record of response) {
    const { nftData, tokenMetadata, status } = await retrieveMetadata(
      record.account.data
    );
    // if data is fetched, parseto mintData and add to array
    if (status.success) {
      const mintData = {
        imageUri: nftData?.image,
        mintWalletAddress,
        nftData,
        tokenMetadata,
        totalSupply,
      };

      mintTokenIds.push(tokenMetadata.mint);
      mints.push(mintData);
      appendToFile(`mint-data:${mintWalletAddress}`, tokenMetadata.mint);
      appendToFile(`mint-token-ids:${mintWalletAddress}`, mintData);
    }

    progressBar.increment();
  }

  if (retries.length > 0) {
    console.log('re-fetching failed txs');
    for (const retry of retries) {
      const { nftData, tokenMetadata, status } = await retrieveMetadata(
        retry.mintAddress
      );
      // if data is fetched, parseto mintData and add to array
      if (status.success) {
        const mintData = {
          imageUri: nftData?.image,
          mintWalletAddress,
          nftData,
          tokenMetadata,
          totalSupply,
        };

        mintTokenIds.push(tokenMetadata.mint);
        mints.push(mintData);
        appendToFile(`mint-data:${mintWalletAddress}`, tokenMetadata.mint);
        appendToFile(`mint-token-ids:${mintWalletAddress}`, mintData);
      }
    }
  } else {
    progressBar.stop();
    console.log(
      '\n',
      `COMPLETE ------------`,
      '\n',
      ` ${mintTokenIds.length} saved || ${retries.length} errors`
    );
  }
})();
