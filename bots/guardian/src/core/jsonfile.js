// Đọc/ghi JSON an toàn. Tách riêng khỏi `store` để tầng trên không cần biết
// chuyện fs, và để `store` chỉ lo phần "file này thuộc guild nào".
const fs = require('fs');
const path = require('path');

/**
 * Đọc JSON, trả `fallback` nếu file không có / hỏng / sai kiểu mong muốn.
 * `check` cho phép chặn kiểu sai (mảng vs object) — JSON.parse thành công không
 * đồng nghĩa nội dung đúng: `{"a":1}` parse ra object, nhưng nếu caller cần
 * mảng thì đọc được rồi vẫn hỏng.
 *
 * @param {string} file
 * @param {*} fallback
 * @param {(v: *) => boolean} [check]
 */
function readJson(file, fallback, check) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`JSON hỏng, dùng giá trị mặc định: ${file}`);
    return fallback;
  }
  if (check && !check(parsed)) {
    console.warn(`JSON sai kiểu, dùng giá trị mặc định: ${file}`);
    return fallback;
  }
  return parsed;
}

/**
 * Ghi JSON **nguyên tử**: ghi file `.tmp` rồi `rename` đè lên file đích.
 *
 * Vì sao không `writeFileSync` thẳng: `writeFileSync` mở file đích với O_TRUNC
 * rồi ghi dần. Crash (hoặc `taskkill` — Windows không gửi SIGTERM) giữa lúc ghi
 * để lại file JSON cụt. File đó thành vĩnh viễn không đọc được, mất dữ liệu
 * luôn. `rename` là thao tác nguyên tử trên cả NTFS nên file đích hoặc là bản
 * cũ, hoặc là bản mới — không bao giờ nửa vời.
 *
 * `fsync` file `.tmp` trước khi rename: không thì rename xong mà nội dung còn
 * nằm trong cache đĩa, mất điện là mất cả bản mới.
 */
function writeJsonAtomic(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2), 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    // Để lại .tmp để không mất dữ liệu đã ghi; lần sau ghi sẽ đè lên.
    console.error('Ghi JSON thất bại:', err.message);
    throw err;
  }
}

module.exports = { readJson, writeJsonAtomic };
