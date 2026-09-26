/**
 * utils.js — Shared utilities for TaskFlow API
 */

/**
 * Paginates an array of records.
 *
 * BUG INC-442: `start` is calculated as `page * limit` instead of `(page - 1) * limit`.
 * This causes page 1 to skip the first `limit` records (off-by-one), and the final
 * page window can exceed the array bounds, leaking `undefined` entries into the response.
 *
 * @param {Array}  data   - Full dataset
 * @param {number} page   - 1-based page number
 * @param {number} limit  - Records per page
 * @returns {{ items: Array, total: number, page: number, limit: number }}
 */
function paginate(data, page, limit) {
  // INC-442: Should be (page - 1) * limit  ← intentional bug
  const start = page * limit;
  const end   = start + limit;           // no bounds check → end may exceed data.length
  const items = data.slice(start, end);  // Array.slice silently returns undefineds at tail

  return {
    items,
    total: data.length,
    page,
    limit,
  };
}

/**
 * Formats a Date object to an ISO-8601 date string (YYYY-MM-DD).
 *
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Generates a simple numeric task ID from a title string.
 *
 * @param {string} title
 * @returns {number}
 */
function generateId(title) {
  return title.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
}

module.exports = { paginate, formatDate, generateId };
