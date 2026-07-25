export interface EmployeeRecord {
  employeeId: string;
  firstName: string;
}

export interface EmployeeStore {
  teamPasscode: string;
  employees: EmployeeRecord[];
}

export interface LoginRequestBody {
  employeeId: string;
  passcode: string;
}

export interface LoginSuccessResponse {
  ok: true;
  employeeId: string;
  firstName: string;
}

export interface LoginErrorResponse {
  ok: false;
  error: string;
}

export type LoginResponse = LoginSuccessResponse | LoginErrorResponse;
