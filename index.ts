import * as fs from 'fs';
import {
  Connection,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  PublicKey,
  Keypair,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
} from '@solana/spl-token';

const idempotent = new PublicKey('id7Fj1ywco2RdzTcQFNcYxf6Wu9iJZeNPtQY9xdsw87');

const associatedProgram = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);
const TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

const mint = new PublicKey(
  process.argv[3] || '9tUX5SNcPjEb5qoDGPf6t6jHcUjG2MQKAMU2sL88T9F',
);

export const createMap = async (map_key: Keypair, bytes: number) => {
  let sender = await getKeypair('./sender.json');
  let map_tx = new Transaction();

  let data = [
    0x77,
    0x08,
    0xa5,
    0xf1,
    0xbb,
    0xc1,
    0xb6,
    0x70,
    bytes & 0xff,
    bytes & 0xff00,
    bytes & 0xff0000,
    bytes & 0xff000000,
  ];

  map_tx.add(
    new TransactionInstruction({
      keys: [
        { pubkey: sender.publicKey, isSigner: true, isWritable: true },
        { pubkey: map_key.publicKey, isSigner: true, isWritable: true },
        {
          pubkey: new PublicKey('11111111111111111111111111111111'),
          isSigner: false,
          isWritable: false,
        },
      ],
      programId: idempotent,
      data: Buffer.from(data),
    }),
  );

  // create idempotent map
  let sig = await sendAndConfirmTransaction(
    connection,
    map_tx,
    [sender, map_key],
    { skipPreflight: true },
  );

  let base_dir = process.cwd() + '/txs/';
  let dir = `${base_dir}${map_key.publicKey.toBase58()}`;
  fs.mkdirSync(`${dir}`, { mode: 0o755 });
  fs.writeFileSync(`${dir}/key`, map_key.secretKey);

  return dir;
};

export const getKeypair = async (filepath: string): Promise<Keypair> => {
  const secretKeyString = fs.readFileSync(filepath, { encoding: 'utf8' });
  const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
  return Keypair.fromSecretKey(secretKey);
};

export const prepareSend = async () => {
  let recipients = JSON.parse(
    fs.readFileSync(process.argv[4] || './recips.json', 'binary'),
  );

  let count = 0;
  for (let k in recipients) {
    count++;
  }

  const sender = await getKeypair('./sender.json');
  let map_key = Keypair.generate();
  let bytes = Math.ceil(count / 9 / 8);
  let dir: string;

  try {
    dir = await createMap(map_key, bytes);
  } catch (e: any) {
    console.log(e);
    throw new Error('Map Failure');
  }

  let send_txs = [];
  let send_tx = new Transaction();
  count = 0;

  let [sender_token] = await PublicKey.findProgramAddress(
    [sender.publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    associatedProgram,
  );

  for (let x in recipients) {
    let recip = x;
    let amount = recipients[recip];

    const [ix, ix2] = await transferTokenIX(
      sender,
      sender_token,
      recip,
      amount,
    );

    send_tx.add(ix);
    send_tx.add(ix2);

    // group 9 send ixs at a time
    if (count % 9 == 0) {
      send_txs.push(send_tx);
      send_tx = new Transaction();
    }

    count++;
  }

  if (send_tx.instructions.length > 0) {
    send_txs.push(send_tx);
  }

  // add all idempotent indexes
  send_txs.forEach((tx, i) => {
    tx.add(
      new TransactionInstruction({
        keys: [
          { pubkey: sender.publicKey, isSigner: true, isWritable: true },
          //@ts-ignore
          { pubkey: map_key.publicKey, isSigner: false, isWritable: true },
        ],
        programId: idempotent,
        data: Buffer.from([
          0x65,
          0xa6,
          0xcb,
          0x90,
          0xf4,
          0xb5,
          0x90,
          0xbe,
          i & 0xff,
          i & 0xff00,
          i & 0xff0000,
          i & 0xff000000,
        ]),
      }),
    );
  });

  // write to fs so we can resume script
  send_txs.forEach((tx, i) => {
    fs.writeFileSync(`${dir}/_${i}`, JSON.stringify(tx));
  });

  return dir;
};

export const sendTransactions = async (dir: string) => {
  let txs: any = fs.readdirSync(dir).filter((e: any) => e[0] === '_');
  txs = txs.map((tx: any) => {
    let temp = new Transaction();
    let parsed = JSON.parse(fs.readFileSync(`${dir}/${tx}`, 'binary'));
    parsed.instructions = parsed.instructions.map((e: any) => {
      e.keys = e.keys.map((e: any) => {
        return { ...e, pubkey: new PublicKey(e.pubkey) };
      });

      e.programId = new PublicKey(e.programId);
      e.data = new Uint8Array(e.data);

      //e.keys.push({ pubkey: e.programId, isSigner: false, isWritable: false });

      return e;
    });
    temp.instructions = parsed.instructions;
    return temp;
  });

  const sender = await getKeypair('./sender.json');

  let promises: any = [];
  // spam transactions
  txs.forEach((tx: any) => {
    promises.push(connection.sendTransaction(tx, [sender]));
  });

  await Promise.all(promises);
};

const transferTokenIX = async (
  sender: Keypair,
  sender_token: PublicKey,
  recip: string,
  amount: number,
) => {
  const recipPublicKey = new PublicKey(recip);
  const recip_token = (
    await PublicKey.findProgramAddress(
      [recipPublicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      associatedProgram,
    )
  )[0];

  const ix = createAssociatedTokenAccountIdempotentInstruction(
    sender.publicKey,
    recip_token,
    recipPublicKey,
    mint,
  );

  const ix2 = createTransferInstruction(
    sender_token,
    recip_token,
    sender.publicKey,
    amount,
  );

  return [ix, ix2];
};

export const main = async () => {
  if (process.argv[2]) {
    await sendTransactions(process.argv[2]);
  } else {
    let dir = await prepareSend();

    await sendTransactions(dir);
  }
};

main().catch((err) => console.error(err));
