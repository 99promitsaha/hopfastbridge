import fs from "node:fs";
import path from "node:path";
import solc from "solc";
const sources = Object.fromEntries(
  ["ArchitectEscrow.sol", "MockUSDC.sol"].map((name) => [
    name,
    { content: fs.readFileSync(`src/${name}`, "utf8") },
  ]),
);
const output = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: "Solidity",
      sources,
      settings: {
        optimizer: { enabled: true, runs: 200 },
        evmVersion: "paris",
        outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
      },
    }),
    {
      import: (name) => {
        try {
          return {
            contents: fs.readFileSync(path.join("node_modules", name), "utf8"),
          };
        } catch {
          return { error: `Import missing: ${name}` };
        }
      },
    },
  ),
);
for (const error of output.errors ?? []) {
  if (error.severity === "error") throw new Error(error.formattedMessage);
}
fs.mkdirSync("artifacts", { recursive: true });
for (const name of ["ArchitectEscrow", "MockUSDC"])
  fs.writeFileSync(
    `artifacts/${name}.json`,
    JSON.stringify(output.contracts[`${name}.sol`][name], null, 2),
  );
for (const folder of [
  "../backend/src/contracts",
  "../frontend/src/contracts",
]) {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    `${folder}/ArchitectEscrow.json`,
    JSON.stringify(
      {
        abi: output.contracts["ArchitectEscrow.sol"].ArchitectEscrow.abi,
        ...(folder.includes("backend")
          ? {
              bytecode: `0x${output.contracts["ArchitectEscrow.sol"].ArchitectEscrow.evm.bytecode.object}`,
            }
          : {}),
      },
      null,
      2,
    ),
  );
}
console.log("Compiled escrow and generated application ABI.");
