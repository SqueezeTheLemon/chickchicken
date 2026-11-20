// 💡 Express 4 는 async 핸들러의 reject 를 못 잡아요 → next(err) 로 넘겨 에러 미들웨어가 처리하게
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
