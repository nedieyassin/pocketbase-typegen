#!/usr/bin/env node

// src/schema.ts
import FormData from "form-data";
import fetch from "cross-fetch";
import { promises as fs } from "fs";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
async function fromDatabase(dbPath) {
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });
  const result = await db.all("SELECT * FROM _collections");
  return result.map((collection) => ({
    ...collection,
    schema: JSON.parse(collection.schema)
  }));
}
async function fromJSON(path) {
  const schemaStr = await fs.readFile(path, { encoding: "utf8" });
  return JSON.parse(schemaStr);
}
async function fromURL(url, email = "", password = "") {
  const formData = new FormData();
  formData.append("email", email);
  formData.append("password", password);
  const { token } = await fetch(`${url}/api/admins/auth-via-email`, {
    method: "post",
    body: formData
  }).then((res) => res.json());
  const result = await fetch(`${url}/api/collections?perPage=200`, {
    headers: {
      Authorization: `Admin ${token}`
    }
  }).then((res) => res.json());
  return result.items;
}

// src/utils.ts
function toPascalCase(str) {
  if (/^[\p{L}\d]+$/iu.test(str)) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
  return str.replace(
    /([\p{L}\d])([\p{L}\d]*)/giu,
    (g0, g1, g2) => g1.toUpperCase() + g2.toLowerCase()
  ).replace(/[^\p{L}\d]/giu, "");
}
function sanitizeFieldName(name) {
  if (!isNaN(parseFloat(name.charAt(0)))) {
    return `"${name}"`;
  } else {
    return name;
  }
}

// src/lib.ts
import { promises as fs2 } from "fs";
var pbSchemaTypescriptMap = {
  text: "string",
  number: "number",
  bool: "boolean",
  email: "string",
  url: "string",
  date: "string",
  select: (opts) => opts.values ? opts.values.map((val) => `"${val}"`).join(" | ") : "string",
  json: "null | unknown",
  file: (opts) => opts.maxSelect && opts.maxSelect > 1 ? "string[]" : "string",
  relation: "string",
  user: "string"
};
function generate(results) {
  const collectionNames = [];
  const recordTypes = [];
  results.forEach((row) => {
    if (row.name)
      collectionNames.push(row.name);
    if (row.schema)
      recordTypes.push(createRecordType(row.name, row.schema));
  });
  const sortedCollectionNames = collectionNames.sort();
  const fileParts = [
    `// This file was @generated using pocketbase-typegen`,
    createCollectionEnum(sortedCollectionNames),
    ...recordTypes.sort(),
    createCollectionRecord(sortedCollectionNames)
  ];
  return fileParts.join("\n\n");
}
function createCollectionEnum(collectionNames) {
  let typeString = `export enum Collections {
`;
  collectionNames.forEach((name) => {
    typeString += `	${toPascalCase(name)} = "${name}",
`;
  });
  typeString += `}`;
  return typeString;
}
function createCollectionRecord(collectionNames) {
  let typeString = `export type CollectionRecords = {
`;
  collectionNames.forEach((name) => {
    typeString += `	${name}: ${toPascalCase(name)}Record
`;
  });
  typeString += `}`;
  return typeString;
}
function createRecordType(name, schema) {
  let typeString = `export type ${toPascalCase(name)}Record = {
`;
  schema.forEach((recordSchema) => {
    typeString += createTypeField(recordSchema);
  });
  typeString += `}`;
  return typeString;
}
function createTypeField(recordSchema) {
  if (!(recordSchema.type in pbSchemaTypescriptMap)) {
    throw new Error(`unknown type ${recordSchema.type} found in schema`);
  }
  const typeStringOrFunc = pbSchemaTypescriptMap[recordSchema.type];
  const typeString = typeof typeStringOrFunc === "function" ? typeStringOrFunc(recordSchema.options) : typeStringOrFunc;
  return `	${sanitizeFieldName(recordSchema.name)}${recordSchema.required ? "" : "?"}: ${typeString}
`;
}
async function saveFile(outPath, typeString) {
  await fs2.writeFile(outPath, typeString, "utf8");
  console.log(`Created typescript definitions at ${outPath}`);
}

// src/index.ts
import { program } from "commander";

// package.json
var version = "1.0.9";

// src/index.ts
async function main(options2) {
  let schema;
  if (options2.db) {
    schema = await fromDatabase(options2.db);
  } else if (options2.json) {
    schema = await fromJSON(options2.json);
  } else if (options2.url) {
    schema = await fromURL(options2.url, options2.email, options2.password);
  } else {
    return console.error(
      "Missing schema path. Check options: pocketbase-typegen --help"
    );
  }
  const typeString = generate(schema);
  await saveFile(options2.out, typeString);
}
program.name("Pocketbase Typegen").version(version).description(
  "CLI to create typescript typings for your pocketbase.io records"
).option("-d, --db <char>", "path to the pocketbase SQLite database").option(
  "-j, --json <char>",
  "path to JSON schema exported from pocketbase admin UI"
).option(
  "-u, --url <char>",
  "URL to your hosted pocketbase instance. When using this options you must also provide email and password options."
).option(
  "-e, --email <char>",
  "email for an admin pocketbase user. Use this with the --url option"
).option(
  "-p, --password <char>",
  "password for an admin pocketbase user. Use this with the --url option"
).option(
  "-o, --out <char>",
  "path to save the typescript output file",
  "pocketbase-types.ts"
);
program.parse(process.argv);
var options = program.opts();
main(options);
