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
    // Get all employees
    const { data: employees, error: employeesError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, username, email')
      .eq('role', 'employee');

    if (employeesError) throw employeesError;

    if (!employees || employees.length === 0) {
      return NextResponse.json({
        highestPresence: null,
        averageAttendance: 0,
        mostAbsents: null,
        totalEmployees: 0
      });
    }

    // Get ALL attendance records (not just last 30 days to get complete picture)
    const { data: attendanceRecords, error: attendanceError } = await supabaseAdmin
      .from('attendance')
      .select('user_id, present, created_at')
      .order('created_at', { ascending: false });

    if (attendanceError) throw attendanceError;

    // Calculate stats for each employee
    const employeeStats = employees.map(employee => {
      const employeeAttendance = attendanceRecords?.filter(record => record.user_id === employee.user_id) || [];
      
      const totalDays = employeeAttendance.length;
      const presentDays = employeeAttendance.filter(record => record.present).length;
      const absentDays = employeeAttendance.filter(record => !record.present).length;
      const presenceRate = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;

      return {
        user_id: employee.user_id,
        username: employee.username || 'Unknown',
        email: employee.email,
        totalDays,
        presentDays,
        absentDays,
        presenceRate
      };
    });

    // Filter out employees with no attendance records for meaningful stats
    const activeEmployees = employeeStats.filter(emp => emp.totalDays > 0);

    // Find employee with highest number of present days (not percentage)
    const highestPresence = activeEmployees.length > 0 
      ? activeEmployees.reduce((prev, current) => 
          (prev.presentDays > current.presentDays) ? prev : current
        )
      : null;

    // Calculate average attendance rate across all employees with attendance
    const averageAttendance = activeEmployees.length > 0 
      ? Math.round(activeEmployees.reduce((sum, emp) => sum + emp.presenceRate, 0) / activeEmployees.length)
      : 0;

    // Find employee with most absent days
    const mostAbsents = activeEmployees.length > 0 
      ? activeEmployees.reduce((prev, current) => 
          (prev.absentDays > current.absentDays) ? prev : current
        )
      : null;

    return NextResponse.json({
      highestPresence: highestPresence ? {
        ...highestPresence,
        displayText: `${highestPresence.presentDays} days present`
      } : null,
      averageAttendance,
      mostAbsents: mostAbsents ? {
        ...mostAbsents,
        displayText: `${mostAbsents.absentDays} days absent`
      } : null,
      totalEmployees: employees.length,
      totalActiveEmployees: activeEmployees.length,
      employeeStats: employeeStats // All employee stats for debugging
    });

  } catch (err: any) {
    console.error('Employee stats fetch error:', err);
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}