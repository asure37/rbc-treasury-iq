import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import employeesJson from "../../../../data/employees.json";
import type { EmployeeStore, LoginRequestBody, LoginResponse } from "@/types/auth";

export const dynamic = "force-dynamic";

const EMPLOYEES_PATH = path.join(process.cwd(), "data", "employees.json");

// The credential list is imported statically so it is bundled at build time — the
// route then works on any host regardless of the runtime working directory (a
// bare readFile(process.cwd()/…) 500s wherever the deploy layout differs).
// We still prefer the on-disk copy when it is readable, so edits to
// data/employees.json take effect without a rebuild in local development.
async function loadStore(): Promise<EmployeeStore> {
  try {
    const raw = await readFile(EMPLOYEES_PATH, "utf-8");
    const parsed = JSON.parse(raw) as EmployeeStore;
    if (parsed?.teamPasscode && Array.isArray(parsed.employees)) return parsed;
  } catch {
    // fall through to the bundled copy
  }
  return employeesJson as EmployeeStore;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as LoginRequestBody | null;
    const employeeId = body?.employeeId?.trim();
    const passcode = body?.passcode?.trim();

    if (!employeeId || !passcode) {
      return NextResponse.json<LoginResponse>({ ok: false, error: "Login ID and passcode are required." }, { status: 400 });
    }

    const store = await loadStore();

    if (passcode.toUpperCase() !== store.teamPasscode.toUpperCase()) {
      return NextResponse.json<LoginResponse>({ ok: false, error: "Incorrect passcode." }, { status: 401 });
    }

    const employee = store.employees.find((e) => e.employeeId.toLowerCase() === employeeId.toLowerCase());
    if (!employee) {
      return NextResponse.json<LoginResponse>({ ok: false, error: "Login ID not recognized." }, { status: 401 });
    }

    return NextResponse.json<LoginResponse>({ ok: true, employeeId: employee.employeeId, firstName: employee.firstName });
  } catch (err) {
    // Never hard-500: the client shows a generic "couldn't reach the
    // authentication service" for a 500, which hides the real cause.
    console.error("[api/login] unexpected failure", err);
    return NextResponse.json<LoginResponse>({ ok: false, error: "Sign-in is temporarily unavailable. Please try again." }, { status: 503 });
  }
}
