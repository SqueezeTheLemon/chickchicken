import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const KEY_LEN = 64;

/**
 * 💡 비밀번호는 "느린 해시(scrypt) + 사용자마다 다른 salt" 로 저장해요.
 *    - salt: 같은 비밀번호라도 해시가 달라져서 미리 계산한 표(rainbow table)가 안 통해요
 *    - 저장 형식: scrypt$<salt base64>$<hash base64>
 */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [algo, saltB64, hashB64] = String(stored).split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  // 비교 시간이 일정해야 "몇 글자까지 맞았는지"를 시간으로 추측할 수 없어요
  return crypto.timingSafeEqual(actual, expected);
}

// 없는 아이디로 로그인할 때도 같은 시간만큼 계산하게 하는 더미 해시 (아이디 존재 여부 노출 방지)
export const DUMMY_HASH = await hashPassword(crypto.randomBytes(16).toString('hex'));
