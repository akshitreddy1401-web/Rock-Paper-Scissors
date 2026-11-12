import path from "node:path";
import { fileURLToPath } from "node:url";
import { DataTypes, Sequelize } from "sequelize";

const databaseUrl = process.env.DATABASE_URL;
const dialectOptions =
  process.env.DB_SSL === "true"
    ? { ssl: { require: true, rejectUnauthorized: false } }
    : undefined;

export const sequelize = databaseUrl
  ? new Sequelize(databaseUrl, {
      dialect: "postgres",
      dialectOptions,
      logging: false,
    })
  : new Sequelize({
      dialect: "sqlite",
      storage: path.join(path.dirname(fileURLToPath(import.meta.url)), "rps.sqlite"),
      logging: false,
    });

export const User = sequelize.define(
  "User",
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    username: { type: DataTypes.STRING(20), allowNull: false },
    usernameKey: { type: DataTypes.STRING(20), allowNull: false, unique: true },
    email: { type: DataTypes.STRING(50), unique: true },
    phone: { type: DataTypes.STRING(16), unique: true },
    passwordHash: { type: DataTypes.STRING(255), allowNull: false },
    role: { type: DataTypes.STRING(10), allowNull: false, defaultValue: "user" },
    tokenVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    wins: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    losses: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    draws: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  },
  { tableName: "users" }
);

export const Room = sequelize.define(
  "Room",
  {
    id: { type: DataTypes.STRING(6), primaryKey: true },
    p1UserId: { type: DataTypes.UUID, allowNull: false },
    p2UserId: { type: DataTypes.UUID },
    p1Choice: { type: DataTypes.STRING(8) },
    p2Choice: { type: DataTypes.STRING(8) },
    winner: { type: DataTypes.STRING(5) },
    p1Score: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    drawScore: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    p2Score: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  },
  {
    tableName: "rooms",
    indexes: [
      { fields: ["p1UserId"] },
      { fields: ["p2UserId"] },
      { fields: ["updatedAt"] },
    ],
  }
);

export const Round = sequelize.define(
  "Round",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    roomId: { type: DataTypes.STRING(6), allowNull: false },
    p1Choice: { type: DataTypes.STRING(8), allowNull: false },
    p2Choice: { type: DataTypes.STRING(8), allowNull: false },
    winner: { type: DataTypes.STRING(5), allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    tableName: "rounds",
    timestamps: false,
    indexes: [{ fields: ["roomId"] }],
  }
);

Room.belongsTo(User, {
  as: "p1",
  foreignKey: "p1UserId",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
Room.belongsTo(User, {
  as: "p2",
  foreignKey: "p2UserId",
  onDelete: "SET NULL",
  onUpdate: "CASCADE",
});
Round.belongsTo(Room, {
  foreignKey: "roomId",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});

export const write = (work) =>
  sequelize.transaction((transaction) => work(transaction));

export const initDb = () => sequelize.sync();
