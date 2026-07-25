import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import type { EmployeeStore, LoginRequestBody, LoginResponse } from "@/types/auth";

const EMPLOYEES_PATH = path.join(process.cwd(), "data", "employees.json");

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as LoginRequestBody | null;
  const employeeId = body?.employeeId?.trim();
  const passcode = body?.passcode?.trim();

  if (!employeeId || !passcode) {
    return NextResponse.json<LoginResponse>({ ok: false, error: "Login ID and passcode are required." }, { status: 400 });
  }

  const raw = await readFile(EMPLOYEES_PATH, "utf-8");
  const store = JSON.parse(raw) as EmployeeStore;

  if (passcode.toUpperCase() !== store.teamPasscode.toUpperCase()) {
    return NextResponse.json<LoginResponse>({ ok: false, error: "Incorrect passcode." }, { status: 401 });
  }

  const employee = store.employees.find((e) => e.employeeId.toLowerCase() === employeeId.toLowerCase());
  if (!employee) {
    return NextResponse.json<LoginResponse>({ ok: false, error: "Login ID not recognized." }, { status: 401 });
  }

  return NextResponse.json<LoginResponse>({ ok: true, employeeId: employee.employeeId, firstName: employee.firstName });
}
