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
function isoDateOnly(d: Date) {
  return d.toISOString().split('T')[0];
}

export async function GET(_request: NextRequest) {
  const reqId = crypto.randomUUID();
  try {
    const supabase = getClient();

    const today = isoDateOnly(new Date());
    const sevenDaysAgo = isoDateOnly(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
    const thirtyDaysAgo = isoDateOnly(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

    // 1. Total Employees
    const { data: totalEmployees, error: employeesError } = await supabase
      .from('user_profiles')
      .select('user_id')
      .eq('role', 'employee');
    if (employeesError) {
      console.error('[insights] employees', { reqId, err: employeesError });
      return jsonError(500, 'db_error', 'Failed to load employees');
    }
    const totalEmployeesCount = totalEmployees?.length || 0;

    // 2. Employee Growth - Last 7 Days
    const { data: employeeGrowth, error: growthError } = await supabase
      .from('user_profiles')
      .select('created_at')
      .eq('role', 'employee')
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: true });
    if (growthError) {
      console.error('[insights] growth', { reqId, err: growthError });
      return jsonError(500, 'db_error', 'Failed to load growth');
    }

    // 3. Today's Attendance
    const { data: todayAttendance, error: attendanceError } = await supabase
      .from('attendance')
      .select('user_id, present')
      .gte('created_at', `${today}T00:00:00`)
      .lt('created_at', `${today}T23:59:59.999`);
    if (attendanceError) {
      console.error('[insights] today attendance', { reqId, err: attendanceError });
      return jsonError(500, 'db_error', 'Failed to load today attendance');
    }

    // 4. Monthly Attendance Trends (last 30 days)
    const { data: monthlyAttendance, error: monthlyError } = await supabase
      .from('attendance')
      .select('created_at, present, user_id')
      .gte('created_at', `${thirtyDaysAgo}T00:00:00`)
      .order('created_at', { ascending: true });
    if (monthlyError) {
      console.error('[insights] monthly', { reqId, err: monthlyError });
      return jsonError(500, 'db_error', 'Failed to load monthly attendance');
    }

    // 5. Role Distribution (kept logic)
    const { data: roleDistribution, error: roleError } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('role', 'employee');
    if (roleError) {
      console.error('[insights] roles', { reqId, err: roleError });
      return jsonError(500, 'db_error', 'Failed to load roles');
    }
    void roleDistribution; // not used further (kept as in your code)

    // 6. Attendance Rate by Day of Week (from last 30 days)
    const { data: weeklyAttendance, error: weeklyError } = await supabase
      .from('attendance')
      .select('created_at, present')
      .gte('created_at', thirtyDaysAgo)
      .order('created_at', { ascending: true });
    if (weeklyError) {
      console.error('[insights] weekly', { reqId, err: weeklyError });
      return jsonError(500, 'db_error', 'Failed to load weekly attendance');
    }

    // Process data for charts
    const growthByDay: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const date = isoDateOnly(new Date(Date.now() - i * 24 * 60 * 60 * 1000));
      growthByDay[date] = 0;
    }
    employeeGrowth?.forEach((emp: any) => {
      const date = String(emp.created_at).split('T')[0];
      if (Object.prototype.hasOwnProperty.call(growthByDay, date)) {
        growthByDay[date]++;
      }
    });
    const growthData = Object.entries(growthByDay).map(([date, count]) => ({
      date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      count,
    }));

    const presentToday = todayAttendance?.filter((att: any) => att.present).length || 0;
    const absentToday = todayAttendance?.filter((att: any) => !att.present).length || 0;
    const notMarkedToday = Math.max(0, totalEmployeesCount - (presentToday + absentToday));

    const attendanceByDate: Record<string, { present: number; absent: number }> = {};
    monthlyAttendance?.forEach((att: any) => {
      const date = String(att.created_at).split('T')[0];
      if (!attendanceByDate[date]) attendanceByDate[date] = { present: 0, absent: 0 };
      if (att.present) attendanceByDate[date].present++;
      else attendanceByDate[date].absent++;
    });

    const monthlyTrend = Object.entries(attendanceByDate)
      .slice(-14)
      .map(([date, data]) => ({
        date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        present: data.present,
        absent: data.absent,
        rate: Math.round((data.present / (data.present + data.absent)) * 100) || 0,
      }));

    const recentAttendees = new Set((monthlyAttendance || []).map((att: any) => att.user_id));
    const activeEmployees = recentAttendees.size;
    const inactiveEmployees = Math.max(0, totalEmployeesCount - activeEmployees);

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weeklyPattern = Array(7)
      .fill(0)
      .map((_, i) => ({ day: dayNames[i], present: 0, total: 0, rate: 0 }));

    weeklyAttendance?.forEach((att: any) => {
      const dayOfWeek = new Date(att.created_at).getDay();
      weeklyPattern[dayOfWeek].total++;
      if (att.present) weeklyPattern[dayOfWeek].present++;
    });
    weeklyPattern.forEach((d) => {
      d.rate = d.total > 0 ? Math.round((d.present / d.total) * 100) : 0;
    });

    return NextResponse.json({
      totalEmployees: totalEmployeesCount,
      employeeGrowth: growthData,
      todayAttendance: { present: presentToday, absent: absentToday, notMarked: notMarkedToday, total: totalEmployeesCount },
      monthlyTrend,
      employeeStatus: { active: activeEmployees, inactive: inactiveEmployees },
      weeklyPattern: weeklyPattern.filter((day) => day.total > 0),
    });
  } catch (err: any) {
    console.error('[insights] unhandled', { reqId, err: err?.message || err });
    return jsonError(500, 'server_error', err?.message || 'Server error');
  }
}
