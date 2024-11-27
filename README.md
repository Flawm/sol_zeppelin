1. update connection on line 24
2. update mint on line 27
3. make a map of recips that looks like this {wallet: amount} in a file called recips.json
4. copy your keypair to a file called sender.json
5. run `pnpm run airdrop`
and 6. if transactions don't go through or it fails you can rerun or spam the airdrop again (safely) with
`pnpm run airdrop txs/{folder_it_creates}`

ps if you run it again you need to pass that folder argument with the map key or it will double spend

pps I'm not doing any token decimal calculations so amount is the smallest denominator by default, so 1 === 0.000_000_001 if the token has 9 decimals, just double check it before you fuck something up like needing to send a massive amount that requires BigInt
