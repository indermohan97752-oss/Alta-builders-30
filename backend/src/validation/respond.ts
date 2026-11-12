import type { Response } from "express";
import type { ZodError } from "zod";

export function sendValidationError(res: Response, err: ZodError) {
  const { fieldErrors, formErrors } = err.flatten();
  return res.status(400).json({
    error: "Validation failed",
    fields: { ...fieldErrors, ...(formErrors.length ? { form: formErrors } : {}) },
  });
}
