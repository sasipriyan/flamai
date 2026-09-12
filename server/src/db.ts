import { MongoClient, type Collection } from "mongodb";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import type { RoomMode } from "./protocol.js";

export type RoomDocument = {
  _id: string;
  roomId: string;
  name: string;
  mode: RoomMode;
  createdBy: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
};

export type Collections = {
  rooms: Collection<RoomDocument>;
};

let client: MongoClient | undefined;
let collections: Collections | undefined;

export async function getCollections(): Promise<Collections> {
  if (collections) return collections;
  if (!config.mongoUri) {
    throw new Error("MONGODB_URI is not configured.");
  }

  client = new MongoClient(config.mongoUri);
  await client.connect();
  const db = client.db(config.mongoDbName);

  collections = {
    rooms: db.collection<RoomDocument>("rooms"),
  };

  await collections.rooms.createIndex({ roomId: 1 }, { unique: true });
  await collections.rooms.createIndex({ createdAt: -1 });

  return collections;
}

export async function listRooms(): Promise<RoomDocument[]> {
  const db = await getCollections();
  return db.rooms.find({}).sort({ createdAt: -1 }).limit(50).toArray();
}

export async function insertRoom(room: RoomDocument): Promise<void> {
  const db = await getCollections();
  await db.rooms.insertOne(room);
}

export async function findRoomById(roomId: string): Promise<RoomDocument | undefined> {
  const db = await getCollections();
  return (await db.rooms.findOne({ roomId })) ?? undefined;
}

export function createRoomId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return `${slug || "room"}-${randomUUID().slice(0, 8)}`;
}
