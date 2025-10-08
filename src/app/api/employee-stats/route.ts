import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}
function ensureEnv() {
  if (!supabaseUrl || !supabaseServiceKey) throw new Error('Server misconfigured: Supabase env vars missing');
}
function getClient() {
  ensureEnv();
  return createClient(supabaseUrl!, supabaseServiceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function GET(_request: NextRequest) {
  const reqId = crypto.randomUUID();
  try {
    const supabase = getClient();

    const { data: employees, error: employeesError } = await supabase
      .from('user_profiles')
      .select('user_id, username, email')
      .eq('role', 'employee');

    if (employeesError) {
      console.error('[employee-stats] employees', { reqId, err: employeesError });
      return jsonError(500, 'db_error', 'Failed to load employees');
    }

    if (!employees || employees.length === 0) {
      return NextResponse.json({
        highestPresence: null,
        averageAttendance: 0,
        mostAbsents: null,
        totalEmployees: 0,
        totalActiveEmployees: 0,
        employeeStats: [],
      });
    }

    const { data: attendanceRecords, error: attendanceError } = await supabase
      .from('attendance')
      .select('user_id, present, created_at')
      .order('created_at', { ascending: false });

    if (attendanceError) {
      console.error('[employee-stats] attendance', { reqId, err: attendanceError });
      return jsonError(500, 'db_error', 'Failed to load attendance');
    }

    const employeeStats = employees.map((employee) => {
      const employeeAttendance = (attendanceRecords || []).filter((r) => r.user_id === employee.user_id);
      const totalDays = employeeAttendance.length;
      const presentDays = employeeAttendance.filter((r) => r.present).length;
      const absentDays = employeeAttendance.filter((r) => !r.present).length;
      const presenceRate = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;

      return {
        user_id: employee.user_id,
        username: employee.username || 'Unknown',
        email: employee.email,
        totalDays,
        presentDays,
        absentDays,
        presenceRate,
      };
    });

    const activeEmployees = employeeStats.filter((emp) => emp.totalDays > 0);

    const highestPresence =
      activeEmployees.length > 0
        ? activeEmployees.reduce((prev, cur) => (prev.presentDays > cur.presentDays ? prev : cur))
        : null;

    const averageAttendance =
      activeEmployees.length > 0
        ? Math.round(activeEmployees.reduce((sum, emp) => sum + emp.presenceRate, 0) / activeEmployees.length)
        : 0;

    const mostAbsents =
      activeEmployees.length > 0
        ? activeEmployees.reduce((prev, cur) => (prev.absentDays > cur.absentDays ? prev : cur))
        : null;

    return NextResponse.json({
      highestPresence: highestPresence ? { ...highestPresence, displayText: `${highestPresence.presentDays} days present` } : null,
      averageAttendance,
      mostAbsents: mostAbsents ? { ...mostAbsents, displayText: `${mostAbsents.absentDays} days absent` } : null,
      totalEmployees: employees.length,
      totalActiveEmployees: activeEmployees.length,
      employeeStats,
    });
  } catch (err: any) {
    console.error('[employee-stats] unhandled', { reqId, err: err?.message || err });
    return jsonError(500, 'server_error', err?.message || 'Server error');
  }
}
