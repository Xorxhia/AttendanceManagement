import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

export async function GET(request: NextRequest) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // 1. Total Employees Count
    const { data: totalEmployees, error: employeesError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id')
      .eq('role', 'employee');

    if (employeesError) throw employeesError;

    // 2. Employee Growth - Last 7 Days
    const { data: employeeGrowth, error: growthError } = await supabaseAdmin
      .from('user_profiles')
      .select('created_at')
      .eq('role', 'employee')
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: true });

    if (growthError) throw growthError;

    // 3. Today's Attendance
    const { data: todayAttendance, error: attendanceError } = await supabaseAdmin
      .from('attendance')
      .select('user_id, present')
      .gte('created_at', `${today}T00:00:00`)
      .lt('created_at', `${today}T23:59:59`);

    if (attendanceError) throw attendanceError;

    // 4. Monthly Attendance Trends
    const { data: monthlyAttendance, error: monthlyError } = await supabaseAdmin
      .from('attendance')
      .select('created_at, present')
      .gte('created_at', `${thirtyDaysAgo}T00:00:00`)
      .order('created_at', { ascending: true });

    if (monthlyError) throw monthlyError;

    // 5. Department/Role Distribution (using roles)
    const { data: roleDistribution, error: roleError } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('role', 'employee');

    if (roleError) throw roleError;

    // 6. Attendance Rate by Day of Week
    const { data: weeklyAttendance, error: weeklyError } = await supabaseAdmin
      .from('attendance')
      .select('created_at, present')
      .gte('created_at', thirtyDaysAgo)
      .order('created_at', { ascending: true });

    if (weeklyError) throw weeklyError;

    // Process data for charts
    
    // Chart 1: Total Employees (simple count)
    const totalEmployeesCount = totalEmployees?.length || 0;

    // Chart 2: Employee Growth (daily counts for last 7 days)
    const growthByDay: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      growthByDay[date] = 0;
    }
    
    employeeGrowth?.forEach((emp: any) => {
      const date = emp.created_at.split('T')[0];
      if (growthByDay.hasOwnProperty(date)) {
        growthByDay[date]++;
      }
    });

    const growthData = Object.entries(growthByDay).map(([date, count]) => ({
      date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      count
    }));

    // Chart 3: Today's Attendance
    const presentToday = todayAttendance?.filter((att: any) => att.present).length || 0;
    const absentToday = todayAttendance?.filter((att: any) => !att.present).length || 0;
    const notMarkedToday = Math.max(0, totalEmployeesCount - (presentToday + absentToday));

    // Chart 4: Monthly Attendance Trend
    const attendanceByDate: Record<string, { present: number; absent: number }> = {};
    monthlyAttendance?.forEach((att: any) => {
      const date = att.created_at.split('T')[0];
      if (!attendanceByDate[date]) {
        attendanceByDate[date] = { present: 0, absent: 0 };
      }
      if (att.present) {
        attendanceByDate[date].present++;
      } else {
        attendanceByDate[date].absent++;
      }
    });

    const monthlyTrend = Object.entries(attendanceByDate)
      .slice(-14) // Last 14 days
      .map(([date, data]) => ({
        date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        present: data.present,
        absent: data.absent,
        rate: Math.round((data.present / (data.present + data.absent)) * 100) || 0
      }));

    // Chart 5: Active vs Inactive Employees (based on recent attendance)
    const recentAttendees = new Set(monthlyAttendance?.map((att: any) => att.user_id) || []);
    const activeEmployees = recentAttendees.size;
    const inactiveEmployees = totalEmployeesCount - activeEmployees;

    // Chart 6: Weekly Attendance Pattern
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weeklyPattern = Array(7).fill(0).map((_, i) => ({ 
      day: dayNames[i], 
      present: 0, 
      total: 0,
      rate: 0
    }));
    
    weeklyAttendance?.forEach((att: any) => {
      const dayOfWeek = new Date(att.created_at).getDay();
      weeklyPattern[dayOfWeek].total++;
      if (att.present) {
        weeklyPattern[dayOfWeek].present++;
      }
    });

    weeklyPattern.forEach(day => {
      day.rate = day.total > 0 ? Math.round((day.present / day.total) * 100) : 0;
    });

    return NextResponse.json({
      totalEmployees: totalEmployeesCount,
      employeeGrowth: growthData,
      todayAttendance: {
        present: presentToday,
        absent: absentToday,
        notMarked: notMarkedToday,
        total: totalEmployeesCount
      },
      monthlyTrend,
      employeeStatus: {
        active: activeEmployees,
        inactive: inactiveEmployees
      },
      weeklyPattern: weeklyPattern.filter(day => day.total > 0) // Only show days with data
    });
  } catch (err: any) {
    console.error('Insights fetch error:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}