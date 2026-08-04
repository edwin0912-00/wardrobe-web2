import os from 'node:os';
import path from 'node:path';

const PRODUCT_NAME = /\b(?:zeely|madeforthisjob)\b/gi;
const FILE_URI = /file:\/\/\/[^\s\])}'"`,;]+/gim;
const POSIX_LOCAL_PATH = /(^|[\s([{'"`])\/(?!\/)(?:[^/\s\])}'"`,;:]+\/)+[^/\s\])}'"`,;:]+/gim;
const WINDOWS_LOCAL_PATH = /(^|[\s([{'"`])[a-z]:\\(?:[^\\\s\])}'"`,;:]+\\)+[^\\\s\])}'"`,;:]+/gim;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceUsername(value, username, replacement) {
  if (typeof username !== 'string' || username.length < 3) return value;
  return value.replace(new RegExp(`\\b${escapeRegExp(username)}\\b`, 'gi'), replacement);
}

/**
 * Remove local application metadata from user- or template-authored text before
 * it becomes an external provider prompt. Media paths are transported through
 * reference descriptors and must never be used as textual reference labels.
 */
export function sanitizeExternalPrompt(value, { username = os.userInfo().username } = {}) {
  let prompt = String(value ?? '');
  prompt = prompt.replace(FILE_URI, 'ATTACHED_REFERENCE');
  prompt = prompt.replace(POSIX_LOCAL_PATH, '$1ATTACHED_REFERENCE');
  prompt = prompt.replace(WINDOWS_LOCAL_PATH, '$1ATTACHED_REFERENCE');
  prompt = replaceUsername(prompt, username, 'LOCAL_USER');
  prompt = prompt.replace(PRODUCT_NAME, 'the product');
  return prompt;
}

export function externalPromptPrivacyViolations(prompt, {
  runtimeRoot = null,
  username = os.userInfo().username,
} = {}) {
  if (typeof prompt !== 'string') return ['INVALID_PROMPT'];
  const violations = [];
  if (/\b(?:zeely|madeforthisjob)\b/i.test(prompt)) violations.push('PRODUCT_NAME');
  if (FILE_URI.test(prompt) || POSIX_LOCAL_PATH.test(prompt) || WINDOWS_LOCAL_PATH.test(prompt)) violations.push('LOCAL_PATH');
  FILE_URI.lastIndex = 0;
  POSIX_LOCAL_PATH.lastIndex = 0;
  WINDOWS_LOCAL_PATH.lastIndex = 0;
  if (typeof username === 'string' && username.length >= 3
    && new RegExp(`\\b${escapeRegExp(username)}\\b`, 'i').test(prompt)) violations.push('LOCAL_USERNAME');
  if (typeof runtimeRoot === 'string' && runtimeRoot.trim() !== '') {
    const resolvedRoot = path.resolve(runtimeRoot);
    if (prompt.includes(resolvedRoot)) violations.push('RUNTIME_ROOT');
  }
  return [...new Set(violations)];
}

export function assertExternalPromptPrivacy(prompt, options = {}) {
  const violations = externalPromptPrivacyViolations(prompt, options);
  if (violations.length === 0) return prompt;
  const error = new Error('External provider prompt contains private local metadata');
  error.code = 'UNSAFE_PROVIDER_PROMPT';
  error.violations = violations;
  throw error;
}
