import { forwardRef, type ComponentPropsWithoutRef } from "react";
import "../../inputs.css";

/** Shared styling while preserving native form, autofill and keyboard semantics. */
export const Input = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<"input">>(function Input({ className = "", type = "text", ...props }, ref) {
  const kind = type === "checkbox" ? "ui-checkbox" : type === "file" ? "ui-file-input" : "ui-input";
  return <input {...props} type={type} ref={ref} className={`${kind} ${className}`} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<"textarea">>(function Textarea({ className = "", ...props }, ref) {
  return <textarea {...props} ref={ref} className={`ui-textarea ${className}`} />;
});
