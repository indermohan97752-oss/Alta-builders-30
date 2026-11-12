import bcrypt from "bcrypt";
import { config } from "../config.js";

/** bcrypt silently ignores everything past 72 bytes, so validation rejects longer passwords. */
export const MAX_PASSWORD_BYTES = 72;

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, config.bcryptRounds);

export const verifyPassword = (plain: string, hash: string): Promise<boolean> => bcrypt.compare(plain, hash);

// Compared against when the username is unknown, so both login failure paths cost similar time.
let dummy: Promise<string> | undefined;
export const dummyHash = () => (dummy ??= bcrypt.hash("not-a-real-password", config.bcryptRounds));
