// src/app/admin/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Profile = {
  user_id: string;
  email: string | null;
  username: string | null;
  role: "admin" | "employee" | null;
  phone?: string | null;
  address?: string | null;
  cnic_no?: string | null;
  avatar_url?: string | null;
};

type TabKey =
  | "create"
  | "directory"
  | "attendance"
  | "view-attendance"
  | "insights"
  | "employee-stats";

export default function AdminPage() {
  const router = useRouter();
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [roleChecking, setRoleChecking] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [users, setUsers] = useState<Profile[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>("insights");
  const [dirLoading, setDirLoading] = useState(false);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Profile>>({});

  // Attendance state
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [attendanceData, setAttendanceData] = useState<Record<string, boolean>>(
    {}
  );
  const [attendanceDates, setAttendanceDates] = useState<Set<string>>(
    new Set()
  );
  const [attendanceLoading, setAttendanceLoading] = useState(false);

  // Pagination state
  const [directoryPage, setDirectoryPage] = useState(1);
  const [attendancePage, setAttendancePage] = useState(1);
  const [selectedEmployee, setSelectedEmployee] = useState<Profile | null>(
    null
  );
  const [employeeAttendance, setEmployeeAttendance] = useState<any[]>([]);
  const [viewAttendanceLoading, setViewAttendanceLoading] = useState(false);
  const [viewEmployeePage, setViewEmployeePage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);

  // Insights state
  const [insightsData, setInsightsData] = useState<any>({});
  const [insightsLoading, setInsightsLoading] = useState(false);

  // Employee Stats state
  const [employeeStatsData, setEmployeeStatsData] = useState<any>({});
  const [employeeStatsLoading, setEmployeeStatsLoading] = useState(false);

  const DIRECTORY_PAGE_SIZE = 10;
  const ATTENDANCE_PAGE_SIZE = 12;
  const VIEW_EMPLOYEE_PAGE_SIZE = 9;
  const HISTORY_PAGE_SIZE = 5;


  // NEW: mobile sidebar state
const [sidebarOpen, setSidebarOpen] = useState(false);

// close sidebar after navigating (mobile)
function goTab(tab: TabKey) {
  setActiveTab(tab);
  if (typeof window !== "undefined" && window.matchMedia("(max-width: 1024px)").matches) {
    setSidebarOpen(false);
  }
}


  function fmtLocalDate(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`; // YYYY-MM-DD in local time
  }

  // Local formatters (make sure these exist once in the file)
  function fmtLocalMonth(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`; // YYYY-MM in local time
  }

  function isFutureMonth(d: Date) {
    const today = new Date();
    const y1 = d.getFullYear(),
      m1 = d.getMonth();
    const y2 = today.getFullYear(),
      m2 = today.getMonth();
    // treat any month strictly after the current month as future
    return y1 > y2 || (y1 === y2 && m1 > m2);
  }
  // Proper sign out function with error handling
  async function handleSignOut() {
    try {
      // Clear local state first
      setSession(null);
      setIsAdmin(false);
      setUsers([]);
      setErr(null);
      setMsg(null);

      // Clear local storage and session storage manually
      localStorage.clear();
      sessionStorage.clear();

      // Clear Supabase session from local storage specifically
      const supabaseKeys = Object.keys(localStorage).filter(
        (key) => key.startsWith("sb-") || key.includes("supabase")
      );
      supabaseKeys.forEach((key) => localStorage.removeItem(key));

      // Force redirect immediately
      router.push("/");

      // Attempt Supabase signOut in background (ignore errors)
      setTimeout(async () => {
        try {
          await supabase.auth.signOut({ scope: "local" });
        } catch {
          // Ignore any errors
        }
      }, 100);
    } catch (error: any) {
      console.warn("Sign out error (continuing):", error.message);
      // Even if there's an error, still redirect to home
      router.push("/");
    }
  }

  // require sign-in
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      if (!data.session) router.push("/");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) router.push("/");
    });
    return () => sub?.subscription.unsubscribe();
  }, [router]);

  // check admin + preload dir if tab is directory
  useEffect(() => {
    (async () => {
      if (!session) return;
      setErr(null);
      setRoleChecking(true);

      const { data: me, error: meErr } = await supabase
        .from("user_profiles")
        .select("role")
        .eq("user_id", session.user.id)
        .single();

      setRoleChecking(false);
      if (meErr) {
        setErr(meErr.message);
        return;
      }
      const admin = me?.role === "admin";
      setIsAdmin(admin);
      if (!admin) return;

      if (activeTab === "directory") await loadUsers();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // load directory whenever switching to directory tab
  useEffect(() => {
    (async () => {
      if (isAdmin && activeTab === "directory") await loadUsers();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isAdmin]);

  async function loadUsers() {
    setErr(null);
    setDirLoading(true);
    const { data, error } = await supabase
      .from("user_profiles")
      .select("user_id,email,username,role,phone,address,cnic_no,avatar_url")
      .eq("role", "employee")
      .order("created_at", { ascending: false });
    setDirLoading(false);
    if (error) setErr(error.message);
    else setUsers((data as Profile[]) || []);
  }

  async function createUser(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    const f = e.currentTarget as any;

    const email = f.email.value.trim();
    const username = f.username.value.trim().toLowerCase();
    const password = f.password.value.trim();
    const phone = f.phone.value.trim();
    const address = f.address.value.trim();
    const cnic_no = f.cnic_no.value.trim();
    const photo: File | null = f.photo.files?.[0] || null;

    if (!username || !password) {
      setErr("Username and password are required.");
      return;
    }

    const fd = new FormData();
    fd.set("email", email);
    fd.set("username", username);
    fd.set("password", password);
    fd.set("phone", phone);
    fd.set("address", address);
    fd.set("cnic_no", cnic_no);
    if (photo) fd.set("photo", photo);

    const res = await fetch("/api/create-user", { method: "POST", body: fd });
    let out: any = {};
    try {
      out = await res.json();
    } catch {}

    if (!res.ok) {
      setErr(out.error || "Create failed");
      return;
    }
    setMsg("User created as employee ✅");
    f.reset();
  }

  async function startEditing(user: Profile) {
    setEditingUser(user.user_id);
    setEditData({
      email: user.email,
      username: user.username,
      phone: user.phone,
      address: user.address,
      cnic_no: user.cnic_no,
      role: user.role,
      avatar_url: user.avatar_url,
    });
  }

  async function saveEdit(userId: string) {
    setErr(null);
    setMsg(null);

    try {
      const { error } = await supabase
        .from("user_profiles")
        .update({
          email: editData.email,
          username: editData.username?.toLowerCase(),
          phone: editData.phone,
          address: editData.address,
          cnic_no: editData.cnic_no,
          role: editData.role,
          avatar_url: editData.avatar_url,
        })
        .eq("user_id", userId);

      if (error) throw error;

      // Update local state
      setUsers(
        users.map((u) => (u.user_id === userId ? { ...u, ...editData } : u))
      );

      setEditingUser(null);
      setEditData({});
      setMsg("Employee updated successfully ✅");
    } catch (e: any) {
      setErr(e?.message || "Failed to update employee");
    }
  }

  function cancelEdit() {
    setEditingUser(null);
    setEditData({});
  }

  async function deleteEmployee(userId: string, email: string) {
    if (
      !confirm(
        `Are you sure you want to delete ${email}? This will permanently remove the user account and all associated data.`
      )
    )
      return;

    setErr(null);
    setMsg(null);
    setDirLoading(true);

    try {
      // First delete from user_profiles
      const { error: profileError } = await supabase
        .from("user_profiles")
        .delete()
        .eq("user_id", userId);

      if (profileError) throw profileError;

      // Then delete the auth user (requires service role)
      const res = await fetch("/api/delete-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to delete user account");
      }

      // Update local state
      setUsers(users.filter((u) => u.user_id !== userId));
      setMsg("Employee deleted successfully ✅");
    } catch (e: any) {
      setErr(e?.message || "Failed to delete employee");
    } finally {
      setDirLoading(false);
    }
  }

  // Attendance functions
  async function loadAttendanceData(date: Date) {
    setAttendanceLoading(true);
    setErr(null);

    try {
      //const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
      const dateStr = fmtLocalDate(date);

      const res = await fetch(`/api/attendance?date=${dateStr}`);
      if (!res.ok) throw new Error("Failed to load attendance data");

      const data = await res.json();
      setAttendanceData(data.attendance || {});
    } catch (e: any) {
      setErr(e?.message || "Failed to load attendance data");
      setAttendanceData({});
    } finally {
      setAttendanceLoading(false);
    }
  }

  // async function loadAttendanceDates(month: Date) {
  //   try {
  //     //const monthStr = month.toISOString().slice(0, 7); // YYYY-MM
  //     const monthStr = fmtLocalMonth(month);

  //     const res = await fetch(`/api/attendance-dates?month=${monthStr}`);
  //     if (!res.ok) throw new Error("Failed to load attendance dates");

  //     const data = await res.json();
  //     setAttendanceDates(new Set(data.dates || []));
  //   } catch (e: any) {
  //     console.error("Failed to load attendance dates:", e);
  //     setAttendanceDates(new Set());
  //   }
  // }
  async function loadAttendanceDates(month: Date) {
    // 1) Don’t fetch for future months; just clear indicators
    if (isFutureMonth(month)) {
      setAttendanceDates(new Set());
      return;
    }

    try {
      const monthStr = fmtLocalMonth(month); // YYYY-MM (local)

      // 2) Bypass any caches + make failures non-fatal
      const res = await fetch(
        `/api/attendance-dates?month=${monthStr}&ts=${Date.now()}`,
        {
          cache: "no-store",
        }
      );

      if (!res.ok) {
        console.warn(
          "attendance-dates fetch not ok:",
          res.status,
          res.statusText
        );
        setAttendanceDates(new Set());
        return; // swallow error; no UI error banner
      }

      const data = await res.json();
      setAttendanceDates(new Set(Array.isArray(data?.dates) ? data.dates : []));
    } catch (e) {
      console.warn("Failed to load attendance dates:", e);
      setAttendanceDates(new Set()); // fail silently with empty dots
    }
  }

  async function saveAttendance() {
    setAttendanceLoading(true);
    setErr(null);
    setMsg(null);

    try {
      //const dateStr = selectedDate.toISOString().split('T')[0]; // YYYY-MM-DD
      const dateStr = fmtLocalDate(selectedDate);

      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: dateStr,
          attendance: attendanceData,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to save attendance");
      }

      setMsg("Attendance saved successfully ✅");

      // Reload attendance dates to update calendar indicators
      await loadAttendanceDates(currentMonth);

      // Also reload the current day's detailed data so toggles reflect persisted state
      await loadAttendanceData(selectedDate);
      if (selectedEmployee) {
        loadEmployeeAttendance(selectedEmployee);
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to save attendance");
    } finally {
      setAttendanceLoading(false);
    }
  }

  async function loadEmployeeAttendance(employee: Profile) {
    setViewAttendanceLoading(true);
    setErr(null);
    setHistoryPage(1); // Reset history pagination when selecting new employee

    try {
      // const response = await fetch(
      //   `/api/employee-attendance?userId=${employee.user_id}`
      // );
      const response = await fetch(
        `/api/employee-attendance?userId=${employee.user_id}&ts=${Date.now()}`,
        { cache: "no-store" }
      );
      const result = await response.json();

      if (!response.ok) {
        setErr(result.error || "Failed to load attendance records");
        return;
      }

      setEmployeeAttendance(result.attendance);
      setSelectedEmployee(employee);
    } catch (error: any) {
      setErr(error.message || "Failed to load attendance records");
    } finally {
      setViewAttendanceLoading(false);
    }
  }

  async function loadInsightsData() {
    setInsightsLoading(true);
    setErr(null);

    try {
      const response = await fetch("/api/insights");
      const result = await response.json();

      if (!response.ok) {
        setErr(result.error || "Failed to load insights data");
        return;
      }

      setInsightsData(result);
    } catch (error: any) {
      setErr(error.message || "Failed to load insights data");
    } finally {
      setInsightsLoading(false);
    }
  }

  async function loadEmployeeStats() {
    setEmployeeStatsLoading(true);
    setErr(null);

    try {
      const response = await fetch("/api/employee-stats");
      const result = await response.json();

      if (!response.ok) {
        setErr(result.error || "Failed to load employee stats");
        return;
      }

      setEmployeeStatsData(result);
    } catch (error: any) {
      setErr(error.message || "Failed to load employee stats");
    } finally {
      setEmployeeStatsLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab !== "attendance") return;

    // Always (re)fetch month markers when landing on the tab or month/date changes
    loadAttendanceDates(currentMonth);

    // Ensure we have users; if not, load once and bail — the effect will re-run after users arrive
    if (isAdmin && users.length === 0) {
      loadUsers();
      return;
    }

    // Once users exist, (re)fetch the selected day's details so toggles are fresh
    if (users.length > 0) {
      loadAttendanceData(selectedDate);
    }
  }, [activeTab, currentMonth, selectedDate, users.length, isAdmin]);

  // When opening "view-attendance", refresh the currently selected employee's records
  useEffect(() => {
    if (activeTab === "view-attendance" && selectedEmployee) {
      loadEmployeeAttendance(selectedEmployee);
    }
  }, [activeTab, selectedEmployee]);

  // Load insights data when switching to insights tab
  useEffect(() => {
    if (activeTab === "insights" && isAdmin) {
      loadInsightsData();
      if (users.length === 0) loadUsers();
    }
  }, [activeTab, isAdmin]);

  // Load employee stats data when switching to employee stats tab
  useEffect(() => {
    if (activeTab === "employee-stats" && isAdmin) {
      loadEmployeeStats();
    }
  }, [activeTab, isAdmin]);

  if (loading || roleChecking)
    return (
      <div className="loading-container">
        <div className="loader"></div>
        <p>Loading admin dashboard...</p>
      </div>
    );
  if (!session)
    return (
      <div className="loading-container">
        <div className="loader"></div>
        <p>Please sign in to continue</p>
      </div>
    );
  if (!isAdmin)
    return (
      <div className="loading-container">
        <div className="loader"></div>
        <p>Access denied. Admin access required.</p>
      </div>
    );

  return (
    <div className="dashboard-container">
      {/* <div className="sidebar">
        <div className="sidebar-header">
          <h1 className="sidebar-title">AttendanceHub</h1>
          <p className="sidebar-subtitle">Admin Portal</p>
        </div> */}
        <div className={`sidebar ${sidebarOpen ? "open" : ""}`}>
  {/* NEW: mobile-only close/header */}
  <div className="sidebar-mobile-header">
    <div>
      <h1 className="sidebar-title">AttendanceHub</h1>
      <p className="sidebar-subtitle">Admin Portal</p>
    </div>
    <button
      className="sidebar-close-btn"
      onClick={() => setSidebarOpen(false)}
      aria-label="Close menu"
    >
      ✕
    </button>
  </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-item ${activeTab === "insights" ? "active" : ""}`}
            onClick={() => goTab("insights")}
          >
            <svg className="nav-icon" fill="currentColor" viewBox="0 0 20 20">
              <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
            </svg>
            Insights
          </button>
          <button
            className={`nav-item ${activeTab === "create" ? "active" : ""}`}
            onClick={() => goTab("create")}
          >
            <svg className="nav-icon" fill="currentColor" viewBox="0 0 20 20">
              <path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 7a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V7z" />
            </svg>
            Create Employee
          </button>
          <button
            className={`nav-item ${activeTab === "directory" ? "active" : ""}`}
            onClick={() => goTab("directory")}
          >
            <svg className="nav-icon" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
            </svg>
            Employee Directory
          </button>
          <button
            className={`nav-item ${activeTab === "attendance" ? "active" : ""}`}
            onClick={() => goTab("attendance")}
          >
            <svg className="nav-icon" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zM4 7h12v9H4V7z" />
              <path d="M7 10a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1z" />
            </svg>
            Attendance Management
          </button>
          <button
            className={`nav-item ${
              activeTab === "view-attendance" ? "active" : ""
            }`}
            onClick={() => goTab("view-attendance")}
          >
            <svg className="nav-icon" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
              <path
                fillRule="evenodd"
                d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                clipRule="evenodd"
              />
            </svg>
            View Attendance
          </button>
          <button
            className={`nav-item ${
              activeTab === "employee-stats" ? "active" : ""
            }`}
            onClick={() => goTab("employee-stats")}
          >
            <svg className="nav-icon" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
              <path
                fillRule="evenodd"
                d="M4 5a2 2 0 012-2v1a1 1 0 002 0V3a2 2 0 012 2v6.5A1.5 1.5 0 019.5 13h-3A1.5 1.5 0 015 11.5V5zM7 7a1 1 0 011-1h2a1 1 0 110 2H8a1 1 0 01-1-1zm1 3a1 1 0 100 2h2a1 1 0 100-2H8z"
                clipRule="evenodd"
              />
              <path d="M14 13h2.5a1.5 1.5 0 001.5-1.5V7a1 1 0 10-2 0v4.5h-2a1 1 0 100 2z" />
            </svg>
            Employee Stats
          </button>
        </nav>

        <div className="sidebar-footer">
          <button onClick={handleSignOut} className="signout-button">
            Sign Out
          </button>
        </div>
      </div>
            {/* NEW: mobile overlay */}
{sidebarOpen && (
  <div
    className="sidebar-overlay"
    onClick={() => setSidebarOpen(false)}
    aria-hidden="true"
  />
)}

      <div className="main-content">
        {/* <div className="main-header">
          <h1 className="page-title">
            {activeTab === "insights"
              ? "Insights & Analytics"
              : activeTab === "create"
              ? "Create Employee"
              : activeTab === "directory"
              ? "Employee Directory"
              : activeTab === "attendance"
              ? "Attendance Management"
              : activeTab === "view-attendance"
              ? "View Attendance"
              : "Employee Stats"}
          </h1>
          <div className="user-info">Logged in as: {session.user?.email}</div>
        </div> */}
        <div className="main-header">
  {/* NEW: mobile hamburger */}
  <button
    className="hamburger-btn"
    onClick={() => setSidebarOpen(true)}
    aria-label="Open menu"
  >
    <span />
    <span />
    <span />
  </button>

  <h1 className="page-title">
    {activeTab === "insights"
      ? "Insights & Analytics"
      : activeTab === "create"
      ? "Create Employee"
      : activeTab === "directory"
      ? "Employee Directory"
      : activeTab === "attendance"
      ? "Attendance Management"
      : activeTab === "view-attendance"
      ? "View Attendance"
      : "Employee Stats"}
  </h1>
  <div className="user-info">Logged in as: {session.user?.email}</div>
</div>


        <div className="content-area">
          {activeTab === "create" && (
            <div className="card">
              <h2 className="card-title">Create Employee Account</h2>
              <form
                onSubmit={createUser}
                encType="multipart/form-data"
                className="form-grid"
              >
                <div className="form-group">
                  <label className="form-label">Email Address</label>
                  <input
                    name="email"
                    type="email"
                    className="form-input"
                    placeholder="employee@company.com"
                    //required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Username</label>
                  <input
                    name="username"
                    className="form-input"
                    placeholder="john.doe"
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Temporary Password</label>
                  <input
                    name="password"
                    type="password"
                    className="form-input"
                    placeholder="Temp123!"
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input
                    name="phone"
                    className="form-input"
                    placeholder="+92 3xx xxxxxxx"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Address</label>
                  <input
                    name="address"
                    className="form-input"
                    placeholder="Street, City"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">CNIC</label>
                  <input
                    name="cnic_no"
                    className="form-input"
                    placeholder="12345-1234567-1"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Photo</label>
                  <input
                    name="photo"
                    type="file"
                    accept="image/*"
                    className="form-input"
                  />
                </div>

                <button type="submit" className="btn-primary">
                  Create Employee
                </button>
              </form>

              {err && (
                <div className="message error-message">
                  <span className="message-icon">⚠</span>
                  {err}
                </div>
              )}
              {msg && (
                <div className="message success-message">
                  <span className="message-icon">✓</span>
                  {msg}
                </div>
              )}
            </div>
          )}

          {activeTab === "directory" && (
            <div className="card">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "16px",
                }}
              >
                <h2 className="card-title" style={{ margin: 0 }}>
                  Employee Directory
                </h2>
                <button
                  onClick={loadUsers}
                  disabled={dirLoading}
                  className="btn-primary"
                >
                  {dirLoading ? "Refreshing…" : "Refresh"}
                </button>
              </div>
                <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Photo</th>
                    <th>Email</th>
                    <th>Username</th>
                    <th>Phone</th>
                    <th>Address</th>
                    <th>CNIC</th>
                    <th>Role</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length > 0 ? (
                    users
                      .slice(
                        (directoryPage - 1) * DIRECTORY_PAGE_SIZE,
                        directoryPage * DIRECTORY_PAGE_SIZE
                      )
                      .map((u) => (
                        <tr key={u.user_id}>
                          <td>
                            {editingUser === u.user_id ? (
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                }}
                              >
                                {editData.avatar_url ? (
                                  <img
                                    src={editData.avatar_url}
                                    alt={editData.username || ""}
                                    style={{
                                      width: 36,
                                      height: 36,
                                      borderRadius: "50%",
                                      objectFit: "cover",
                                    }}
                                  />
                                ) : (
                                  <img
                                    src="/icon-emp.png"
                                    alt="Default Employee"
                                    style={{
                                      width: 36,
                                      height: 36,
                                      borderRadius: "50%",
                                      objectFit: "cover",
                                    }}
                                  />
                                )}
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      const reader = new FileReader();
                                      reader.onload = (event) => {
                                        setEditData({
                                          ...editData,
                                          avatar_url: event.target
                                            ?.result as string,
                                        });
                                      };
                                      reader.readAsDataURL(file);
                                    }
                                  }}
                                  className="file-input-small"
                                />
                              </div>
                            ) : u.avatar_url ? (
                              <img
                                src={u.avatar_url}
                                alt={u.username || ""}
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: "50%",
                                  objectFit: "cover",
                                }}
                              />
                            ) : (
                              <img
                                src="/icon-emp.png"
                                alt="Default Employee"
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: "50%",
                                  objectFit: "cover",
                                }}
                              />
                            )}
                          </td>

                          {/* Email */}
                          <td>
                            {editingUser === u.user_id ? (
                              <input
                                type="email"
                                value={editData.email || ""}
                                onChange={(e) =>
                                  setEditData({
                                    ...editData,
                                    email: e.target.value,
                                  })
                                }
                                className="edit-input"
                              />
                            ) : (
                              <span>{u.email}</span>
                            )}
                          </td>

                          {/* Username */}
                          <td>
                            {editingUser === u.user_id ? (
                              <input
                                type="text"
                                value={editData.username || ""}
                                onChange={(e) =>
                                  setEditData({
                                    ...editData,
                                    username: e.target.value,
                                  })
                                }
                                className="edit-input"
                              />
                            ) : (
                              <span>{u.username}</span>
                            )}
                          </td>

                          {/* Phone */}
                          <td>
                            {editingUser === u.user_id ? (
                              <input
                                type="text"
                                value={editData.phone || ""}
                                onChange={(e) =>
                                  setEditData({
                                    ...editData,
                                    phone: e.target.value,
                                  })
                                }
                                className="edit-input"
                              />
                            ) : (
                              <span>{u.phone || "-"}</span>
                            )}
                          </td>

                          {/* Address */}
                          <td>
                            {editingUser === u.user_id ? (
                              <input
                                type="text"
                                value={editData.address || ""}
                                onChange={(e) =>
                                  setEditData({
                                    ...editData,
                                    address: e.target.value,
                                  })
                                }
                                className="edit-input"
                              />
                            ) : (
                              <span>{u.address || "-"}</span>
                            )}
                          </td>

                          {/* CNIC */}
                          <td>
                            {editingUser === u.user_id ? (
                              <input
                                type="text"
                                value={editData.cnic_no || ""}
                                onChange={(e) =>
                                  setEditData({
                                    ...editData,
                                    cnic_no: e.target.value,
                                  })
                                }
                                className="edit-input"
                              />
                            ) : (
                              <span>{u.cnic_no || "-"}</span>
                            )}
                          </td>

                          {/* Role */}
                          <td>
                            {editingUser === u.user_id ? (
                              <select
                                value={editData.role || ""}
                                onChange={(e) =>
                                  setEditData({
                                    ...editData,
                                    role: e.target.value as
                                      | "admin"
                                      | "employee",
                                  })
                                }
                                className="edit-input"
                              >
                                <option value="employee">Employee</option>
                                <option value="admin">Admin</option>
                              </select>
                            ) : (
                              <span>{u.role}</span>
                            )}
                          </td>

                          {/* Actions */}
                          <td>
                            {editingUser === u.user_id ? (
                              <div className="action-buttons">
                                <button
                                  onClick={() => saveEdit(u.user_id)}
                                  className="btn-save"
                                  title="Save Changes"
                                >
                                  <svg
                                    className="btn-icon"
                                    fill="currentColor"
                                    viewBox="0 0 20 20"
                                  >
                                    <path
                                      fillRule="evenodd"
                                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                </button>
                                <button
                                  onClick={cancelEdit}
                                  className="btn-cancel"
                                  title="Cancel Edit"
                                >
                                  <svg
                                    className="btn-icon"
                                    fill="currentColor"
                                    viewBox="0 0 20 20"
                                  >
                                    <path
                                      fillRule="evenodd"
                                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                </button>
                              </div>
                            ) : (
                              <div className="action-buttons">
                                <button
                                  onClick={() => startEditing(u)}
                                  className="btn-edit"
                                  title="Edit Employee"
                                >
                                  <svg
                                    className="btn-icon"
                                    fill="currentColor"
                                    viewBox="0 0 20 20"
                                  >
                                    <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() =>
                                    deleteEmployee(u.user_id, u.email || "")
                                  }
                                  className="btn-delete"
                                  title="Delete Employee"
                                  disabled={dirLoading}
                                >
                                  <svg
                                    className="btn-icon"
                                    fill="currentColor"
                                    viewBox="0 0 20 20"
                                  >
                                    <path
                                      fillRule="evenodd"
                                      d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))
                  ) : (
                    <tr>
                      <td colSpan={8} className="empty-state">
                        No employees found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>

              {/* Directory Pagination */}
              {users.length > DIRECTORY_PAGE_SIZE && (
                <div className="pagination-container">
                  <div className="pagination-info">
                    Showing {(directoryPage - 1) * DIRECTORY_PAGE_SIZE + 1} to{" "}
                    {Math.min(
                      directoryPage * DIRECTORY_PAGE_SIZE,
                      users.length
                    )}{" "}
                    of {users.length} employees
                  </div>
                  <div className="pagination-controls">
                    <button
                      className="pagination-btn"
                      onClick={() =>
                        setDirectoryPage(Math.max(1, directoryPage - 1))
                      }
                      disabled={directoryPage === 1}
                    >
                      <svg
                        className="pagination-icon"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                      Previous
                    </button>

                    <div className="pagination-numbers scroller-x">
                      {Array.from(
                        {
                          length: Math.ceil(users.length / DIRECTORY_PAGE_SIZE),
                        },
                        (_, i) => i + 1
                      )
                        .filter((page) => Math.abs(page - directoryPage) <= 2)
                        .map((page) => (
                          <button
                            key={page}
                            className={`pagination-number ${
                              page === directoryPage ? "active" : ""
                            }`}
                            onClick={() => setDirectoryPage(page)}
                          >
                            {page}
                          </button>
                        ))}
                    </div>

                    <button
                      className="pagination-btn"
                      onClick={() =>
                        setDirectoryPage(
                          Math.min(
                            Math.ceil(users.length / DIRECTORY_PAGE_SIZE),
                            directoryPage + 1
                          )
                        )
                      }
                      disabled={
                        directoryPage ===
                        Math.ceil(users.length / DIRECTORY_PAGE_SIZE)
                      }
                    >
                      Next
                      <svg
                        className="pagination-icon"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              {err && (
                <div className="message error-message">
                  <span className="message-icon">⚠</span>
                  {err}
                </div>
              )}
            </div>
          )}

          {activeTab === "attendance" && (
            <div className="attendance-container">
              <div className="calendar-section">
                <div className="card">
                  <div className="calendar-header">
                    <button
                      className="calendar-nav-btn"
                      onClick={() =>
                        setCurrentMonth(
                          new Date(
                            currentMonth.getFullYear(),
                            currentMonth.getMonth() - 1
                          )
                        )
                      }
                      title="Previous Month"
                    >
                      <svg
                        className="calendar-nav-icon"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                    <h2 className="calendar-title">
                      {currentMonth.toLocaleDateString("en-US", {
                        month: "long",
                        year: "numeric",
                      })}
                    </h2>
                    <button
                      className="calendar-nav-btn"
                      onClick={() =>
                        setCurrentMonth(
                          new Date(
                            currentMonth.getFullYear(),
                            currentMonth.getMonth() + 1
                          )
                        )
                      }
                      title="Next Month"
                    >
                      <svg
                        className="calendar-nav-icon"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  </div>

                  <div className="calendar-grid">
                    <div className="calendar-weekdays">
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                        (day) => (
                          <div key={day} className="calendar-weekday">
                            {day}
                          </div>
                        )
                      )}
                    </div>

                    <div className="calendar-days">
                      {(() => {
                        const firstDay = new Date(
                          currentMonth.getFullYear(),
                          currentMonth.getMonth(),
                          1
                        );
                        const lastDay = new Date(
                          currentMonth.getFullYear(),
                          currentMonth.getMonth() + 1,
                          0
                        );
                        const startDate = new Date(firstDay);
                        startDate.setDate(
                          startDate.getDate() - firstDay.getDay()
                        );

                        const days = [];
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);

                        for (let i = 0; i < 42; i++) {
                          const date = new Date(startDate);
                          date.setDate(startDate.getDate() + i);

                          const isCurrentMonth =
                            date.getMonth() === currentMonth.getMonth();
                          const isToday = date.getTime() === today.getTime();
                          const isFuture = date > today;
                          const isSelected =
                            selectedDate.toDateString() === date.toDateString();
                          //const dateKey = date.toISOString().split('T')[0];
                          const dateKey = fmtLocalDate(date);
                          const hasData = attendanceDates.has(dateKey);

                          let className = "calendar-day";
                          if (!isCurrentMonth) className += " other-month";
                          if (isToday) className += " today";
                          if (isFuture) className += " future";
                          if (isSelected) className += " selected";
                          if (hasData) className += " has-data";

                          const isClickable =
                            isCurrentMonth && (!isFuture || isToday);

                          days.push(
                            <button
                              key={i}
                              className={className}
                              onClick={() =>
                                isClickable && setSelectedDate(new Date(date))
                              }
                              disabled={!isClickable}
                              title={
                                isFuture
                                  ? "Future dates are locked"
                                  : hasData
                                  ? "Attendance recorded"
                                  : "No attendance data"
                              }
                            >
                              {date.getDate()}
                              {hasData && (
                                <div className="data-indicator"></div>
                              )}
                            </button>
                          );
                        }
                        return days;
                      })()}
                    </div>
                  </div>
                </div>
              </div>

              <div className="attendance-section">
                <div className="card">
                  <div className="attendance-header">
                    <h3 className="attendance-title">
                      Attendance for{" "}
                      {selectedDate.toLocaleDateString("en-US", {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </h3>
                    <button
                      className="btn-primary save-attendance-btn"
                      onClick={saveAttendance}
                      disabled={attendanceLoading}
                    >
                      <svg
                        className="btn-icon"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                      {attendanceLoading ? "Saving..." : "Save Attendance"}
                    </button>
                  </div>

                  {attendanceLoading && (
                    <div className="loading-overlay">
                      <div className="loading-container">
                        <div className="loader"></div>
                        <p>Loading employee data...</p>
                      </div>
                    </div>
                  )}

                  <div
                    className={`employee-attendance-grid ${
                      attendanceLoading ? "content-blur" : ""
                    }`}
                    style={{ position: "relative" }}
                  >
                    {!attendanceLoading &&
                    users.filter((user) => user.role === "employee").length >
                      0 ? (
                      users
                        .filter((user) => user.role === "employee")
                        .slice(
                          (attendancePage - 1) * ATTENDANCE_PAGE_SIZE,
                          attendancePage * ATTENDANCE_PAGE_SIZE
                        )
                        .map((user) => (
                          <div
                            key={user.user_id}
                            className="employee-attendance-card"
                          >
                            <div className="employee-info">
                              <div className="employee-avatar">
                                {user.avatar_url ? (
                                  <img
                                    src={user.avatar_url}
                                    alt={user.username || "Employee"}
                                  />
                                ) : (
                                  <img
                                    src="/icon-emp.png"
                                    alt="Default Employee"
                                    className="avatar-placeholder"
                                  />
                                )}
                              </div>
                              <div className="employee-details">
                                <h4 className="employee-name">
                                  {user.username}
                                </h4>
                                <p className="employee-email">{user.email}</p>
                              </div>
                            </div>

                            <div className="attendance-toggle">
                              <label className="toggle-switch">
                                <input
                                  type="checkbox"
                                  checked={
                                    attendanceData[user.user_id] || false
                                  }
                                  onChange={(e) =>
                                    setAttendanceData((prev) => ({
                                      ...prev,
                                      [user.user_id]: e.target.checked,
                                    }))
                                  }
                                />
                                <span className="toggle-slider">
                                  <span className="toggle-text">
                                    {attendanceData[user.user_id]
                                      ? "Present"
                                      : "Absent"}
                                  </span>
                                </span>
                              </label>
                            </div>
                          </div>
                        ))
                    ) : (
                      <div className="empty-state">
                        No employees found. Please create employees first.
                      </div>
                    )}
                  </div>

                  {/* Attendance Pagination */}
                  {!attendanceLoading &&
                    users.filter((user) => user.role === "employee").length >
                      ATTENDANCE_PAGE_SIZE && (
                      <div
                        className="pagination-container"
                        style={{ marginTop: "16px" }}
                      >
                        <div className="pagination-info">
                          Showing{" "}
                          {(attendancePage - 1) * ATTENDANCE_PAGE_SIZE + 1} to{" "}
                          {Math.min(
                            attendancePage * ATTENDANCE_PAGE_SIZE,
                            users.filter((user) => user.role === "employee")
                              .length
                          )}{" "}
                          of{" "}
                          {
                            users.filter((user) => user.role === "employee")
                              .length
                          }{" "}
                          employees
                        </div>
                        <div className="pagination-controls">
                          <button
                            className="pagination-btn"
                            onClick={() =>
                              setAttendancePage(Math.max(1, attendancePage - 1))
                            }
                            disabled={attendancePage === 1}
                          >
                            <svg
                              className="pagination-icon"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                            Previous
                          </button>

                          <div className="pagination-numbers scroller-x">
                            {Array.from(
                              {
                                length: Math.ceil(
                                  users.filter(
                                    (user) => user.role === "employee"
                                  ).length / ATTENDANCE_PAGE_SIZE
                                ),
                              },
                              (_, i) => i + 1
                            )
                              .filter(
                                (page) => Math.abs(page - attendancePage) <= 2
                              )
                              .map((page) => (
                                <button
                                  key={page}
                                  className={`pagination-number ${
                                    page === attendancePage ? "active" : ""
                                  }`}
                                  onClick={() => setAttendancePage(page)}
                                >
                                  {page}
                                </button>
                              ))}
                          </div>

                          <button
                            className="pagination-btn"
                            onClick={() =>
                              setAttendancePage(
                                Math.min(
                                  Math.ceil(
                                    users.filter(
                                      (user) => user.role === "employee"
                                    ).length / ATTENDANCE_PAGE_SIZE
                                  ),
                                  attendancePage + 1
                                )
                              )
                            }
                            disabled={
                              attendancePage ===
                              Math.ceil(
                                users.filter((user) => user.role === "employee")
                                  .length / ATTENDANCE_PAGE_SIZE
                              )
                            }
                          >
                            Next
                            <svg
                              className="pagination-icon"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>
                    )}

                  {err && (
                    <div className="message error-message">
                      <span className="message-icon">⚠</span>
                      {err}
                    </div>
                  )}
                  {msg && (
                    <div className="message success-message">
                      <span className="message-icon">✅</span>
                      {msg}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "view-attendance" && (
            <div className="card">
              <h2 className="card-title">View Employee Attendance</h2>

              <div className="employee-selection-section">
                <h3 style={{ marginBottom: "16px", color: "#374151" }}>
                  Select Employee
                </h3>
                <div className="employee-grid">
                  {users
                    .filter((user) => user.role === "employee")
                    .slice(
                      (viewEmployeePage - 1) * VIEW_EMPLOYEE_PAGE_SIZE,
                      viewEmployeePage * VIEW_EMPLOYEE_PAGE_SIZE
                    )
                    .map((employee) => (
                      <div
                        key={employee.user_id}
                        className={`employee-card ${
                          selectedEmployee?.user_id === employee.user_id
                            ? "selected"
                            : ""
                        }`}
                        onClick={() => loadEmployeeAttendance(employee)}
                      >
                        <div className="employee-avatar">
                          {employee.avatar_url ? (
                            <img
                              src={employee.avatar_url}
                              alt={employee.username || "Employee"}
                            />
                          ) : (
                            <img
                              src="/icon-emp.png"
                              alt="Default Employee"
                              className="avatar-placeholder"
                            />
                          )}
                        </div>
                        <div className="employee-details">
                          <h4 className="employee-name">{employee.username}</h4>
                          <p className="employee-email">{employee.email}</p>
                        </div>
                      </div>
                    ))}
                </div>

                {/* Employee Selection Pagination */}
                {users.filter((user) => user.role === "employee").length >
                  VIEW_EMPLOYEE_PAGE_SIZE && (
                  <div
                    className="pagination-container"
                    style={{ marginTop: "16px" }}
                  >
                    <div className="pagination-info">
                      Showing{" "}
                      {(viewEmployeePage - 1) * VIEW_EMPLOYEE_PAGE_SIZE + 1} to{" "}
                      {Math.min(
                        viewEmployeePage * VIEW_EMPLOYEE_PAGE_SIZE,
                        users.filter((user) => user.role === "employee").length
                      )}{" "}
                      of{" "}
                      {users.filter((user) => user.role === "employee").length}{" "}
                      employees
                    </div>
                    <div className="pagination-controls">
                      <button
                        className="pagination-btn"
                        onClick={() =>
                          setViewEmployeePage(Math.max(1, viewEmployeePage - 1))
                        }
                        disabled={viewEmployeePage === 1}
                      >
                        <svg
                          className="pagination-icon"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                        Previous
                      </button>

                      <div className="pagination-numbers scroller-x">
                        {Array.from(
                          {
                            length: Math.ceil(
                              users.filter((user) => user.role === "employee")
                                .length / VIEW_EMPLOYEE_PAGE_SIZE
                            ),
                          },
                          (_, i) => i + 1
                        )
                          .filter(
                            (page) => Math.abs(page - viewEmployeePage) <= 2
                          )
                          .map((page) => (
                            <button
                              key={page}
                              className={`pagination-number ${
                                page === viewEmployeePage ? "active" : ""
                              }`}
                              onClick={() => setViewEmployeePage(page)}
                            >
                              {page}
                            </button>
                          ))}
                      </div>

                      <button
                        className="pagination-btn"
                        onClick={() =>
                          setViewEmployeePage(
                            Math.min(
                              Math.ceil(
                                users.filter((user) => user.role === "employee")
                                  .length / VIEW_EMPLOYEE_PAGE_SIZE
                              ),
                              viewEmployeePage + 1
                            )
                          )
                        }
                        disabled={
                          viewEmployeePage ===
                          Math.ceil(
                            users.filter((user) => user.role === "employee")
                              .length / VIEW_EMPLOYEE_PAGE_SIZE
                          )
                        }
                      >
                        Next
                        <svg
                          className="pagination-icon"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {selectedEmployee && (
                <div className="attendance-history-section">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: "20px",
                    }}
                  >
                    <h3 style={{ color: "#374151", margin: 0 }}>
                      Attendance History - {selectedEmployee.username}
                    </h3>
                    <div className="attendance-stats">
                      <span className="stat-item present">
                        Present:{" "}
                        {
                          employeeAttendance.filter((record) => record.present)
                            .length
                        }
                      </span>
                      <span className="stat-item absent">
                        Absent:{" "}
                        {
                          employeeAttendance.filter((record) => !record.present)
                            .length
                        }
                      </span>
                      <span className="stat-item total">
                        Total: {employeeAttendance.length}
                      </span>
                    </div>
                  </div>

                  {viewAttendanceLoading && (
                    <div className="loading-overlay">
                      <div className="loading-container">
                        <div className="loader"></div>
                        <p>Loading attendance records...</p>
                      </div>
                    </div>
                  )}

                  <div
                    className={`attendance-table-container ${
                      viewAttendanceLoading ? "content-blur" : ""
                    }`}
                    style={{ position: "relative" }}
                  >
                    {!viewAttendanceLoading && employeeAttendance.length > 0 ? (
                      <div className="attendance-table-container">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Status</th>
                              <th>Time</th>
                              <th>Note</th>
                              <th>Location</th>
                            </tr>
                          </thead>
                          <tbody>
                            {employeeAttendance
                              .slice(
                                (historyPage - 1) * HISTORY_PAGE_SIZE,
                                historyPage * HISTORY_PAGE_SIZE
                              )
                              .map((record, index) => (
                                <tr key={index}>
                                  {/* <td>{new Date(record.date).toLocaleDateString('en-US', { 
                                weekday: 'short',
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric'
                              })}</td> */}
                                  <td>
                                    {new Date(
                                      record.created_at
                                    ).toLocaleDateString("en-US", {
                                      weekday: "short",
                                      year: "numeric",
                                      month: "short",
                                      day: "numeric",
                                    })}
                                  </td>
                                  <td>
                                    {new Date(
                                      record.created_at
                                    ).toLocaleTimeString("en-US", {
                                      hour12: false,
                                    })}
                                  </td>

                                  <td>
                                    <span
                                      className={`status-badge ${
                                        record.present ? "present" : "absent"
                                      }`}
                                    >
                                      {record.status}
                                    </span>
                                  </td>
                                  <td>{record.time}</td>
                                  <td>{record.note || "-"}</td>
                                  <td>
                                    {record.lat && record.lng
                                      ? `${record.lat.toFixed(
                                          4
                                        )}, ${record.lng.toFixed(4)}`
                                      : "-"}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>

                        {/* History Pagination */}
                        {employeeAttendance.length > HISTORY_PAGE_SIZE && (
                          <div
                            className="pagination-container"
                            style={{ marginTop: "16px" }}
                          >
                            <div className="pagination-info">
                              Showing{" "}
                              {(historyPage - 1) * HISTORY_PAGE_SIZE + 1} to{" "}
                              {Math.min(
                                historyPage * HISTORY_PAGE_SIZE,
                                employeeAttendance.length
                              )}{" "}
                              of {employeeAttendance.length} records
                            </div>
                            <div className="pagination-controls">
                              <button
                                className="pagination-btn"
                                onClick={() =>
                                  setHistoryPage(Math.max(1, historyPage - 1))
                                }
                                disabled={historyPage === 1}
                              >
                                <svg
                                  className="pagination-icon"
                                  fill="currentColor"
                                  viewBox="0 0 20 20"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                                Previous
                              </button>

                              <div className="pagination-numbers  scroller-x">
                                {Array.from(
                                  {
                                    length: Math.ceil(
                                      employeeAttendance.length /
                                        HISTORY_PAGE_SIZE
                                    ),
                                  },
                                  (_, i) => i + 1
                                )
                                  .filter(
                                    (page) => Math.abs(page - historyPage) <= 2
                                  )
                                  .map((page) => (
                                    <button
                                      key={page}
                                      className={`pagination-number ${
                                        page === historyPage ? "active" : ""
                                      }`}
                                      onClick={() => setHistoryPage(page)}
                                    >
                                      {page}
                                    </button>
                                  ))}
                              </div>

                              <button
                                className="pagination-btn"
                                onClick={() =>
                                  setHistoryPage(
                                    Math.min(
                                      Math.ceil(
                                        employeeAttendance.length /
                                          HISTORY_PAGE_SIZE
                                      ),
                                      historyPage + 1
                                    )
                                  )
                                }
                                disabled={
                                  historyPage ===
                                  Math.ceil(
                                    employeeAttendance.length /
                                      HISTORY_PAGE_SIZE
                                  )
                                }
                              >
                                Next
                                <svg
                                  className="pagination-icon"
                                  fill="currentColor"
                                  viewBox="0 0 20 20"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      !viewAttendanceLoading && (
                        <div className="empty-state">
                          No attendance records found for this employee.
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}

              {!selectedEmployee && (
                <div className="empty-state">
                  Select an employee to view their attendance history.
                </div>
              )}

              {err && (
                <div className="message error-message">
                  <span className="message-icon">⚠</span>
                  {err}
                </div>
              )}
            </div>
          )}

          {activeTab === "insights" && (
            <div className="insights-container">
              <div className="insights-header">
                <h2 className="insights-title">Analytics Dashboard</h2>
                <button
                  onClick={loadInsightsData}
                  disabled={insightsLoading}
                  className="btn-primary"
                >
                  {insightsLoading ? "Refreshing..." : "Refresh Data"}
                </button>
              </div>

              {insightsLoading ? (
                <div className="loading-overlay">
                  <div className="loading-container">
                    <div className="loader"></div>
                    <p>Loading analytics data...</p>
                  </div>
                </div>
              ) : null}

              <div
                className={`charts-grid ${
                  insightsLoading ? "content-blur" : ""
                }`}
                style={{ position: "relative" }}
              >
                {!insightsLoading && (
                  <>
                    {/* Chart 1: Total Employees (Revamped KPI) */}
                    <div className="kpi-card">
                      <div className="kpi-header">
                        <div className="kpi-title-wrap">
                          <svg
                            className="kpi-title-icon"
                            viewBox="0 0 20 20"
                            aria-hidden="true"
                          >
                            <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                          </svg>
                          <h3 className="kpi-title">Total Employees</h3>
                        </div>

                        {/* Delta vs last 7 days (sum of employeeGrowth) */}
                        {(() => {
                          const total = insightsData?.totalEmployees ?? 0;
                          const weekAdds = (
                            insightsData?.employeeGrowth || []
                          ).reduce(
                            (a: number, p: any) => a + (p?.count || 0),
                            0
                          );
                          const trendUp = weekAdds >= 0;
                          return (
                            <div
                              className={`kpi-delta ${trendUp ? "up" : "down"}`}
                              aria-live="polite"
                            >
                              <span
                                className="kpi-delta-icon"
                                aria-hidden="true"
                              >
                                {trendUp ? "▲" : "▼"}
                              </span>
                              <span className="kpi-delta-text">
                                {trendUp ? "+" : ""}
                                {weekAdds} this week
                              </span>
                            </div>
                          );
                        })()}
                      </div>

                      <div className="kpi-body">
                        {/* Glowing ring with animated sweep */}
                        {(() => {
                          const total = insightsData?.totalEmployees ?? 0;
                          // Cap ring “fill” at 100 for visual; if you want a real target, replace 100 with your target value
                          const pct = Math.min(100, total);
                          return (
                            <div
                              className="kpi-ring-wrap"
                              role="img"
                              aria-label={`Total employees ${total}`}
                            >
                              <div
                                className="kpi-ring"
                                style={{ ["--ring-fill" as any]: `${pct}%` }}
                              >
                                <div className="kpi-ring-sweep" />
                                <div className="kpi-center">
                                  <div className="kpi-number">
                                    {total.toLocaleString()}
                                  </div>
                                  <div className="kpi-sub">
                                    Active Employees
                                  </div>
                                </div>
                              </div>
                              <div className="kpi-glow" aria-hidden="true" />
                            </div>
                          );
                        })()}

                        {/* Tiny sparkline using the last 7 days growth */}
                        <div className="kpi-spark">
                          {(insightsData?.employeeGrowth || []).map(
                            (p: any, i: number, arr: any[]) => {
                              const max = Math.max(
                                ...arr.map((x: any) => x?.count || 0),
                                1
                              );
                              const h = Math.max(
                                6,
                                Math.round(((p?.count || 0) / max) * 30)
                              );
                              return (
                                <span
                                  key={i}
                                  className="kpi-spark-bar"
                                  style={{ height: `${h}px` }}
                                  title={`${p?.date}: ${p?.count || 0}`}
                                />
                              );
                            }
                          )}
                        </div>
                      </div>

                      {/* Soft gradient footer stats */}
                      <div className="kpi-footer">
                        <div className="kpi-chip">
                          <span className="kpi-dot" />
                          HR Active
                        </div>
                        <div className="kpi-chip">
                          <span className="kpi-dot alt" />
                          LIVE
                        </div>
                      </div>
                    </div>

                    {/* Chart 2: Employee Growth (Last 7 Days) */}
                    <div className="chart-card">
                      <div className="chart-header">
                        <h3 className="chart-title">
                          Employee Growth (7 Days)
                        </h3>
                        <svg
                          className="chart-icon"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11.707 4.707a1 1 0 00-1.414-1.414L10 9.586 8.707 8.293a1 1 0 00-1.414 0l-2 2a1 1 0 101.414 1.414L8 10.414l1.293 1.293a1 1 0 001.414 0l4-4z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>
                      <div className="line-chart">
                        {insightsData.employeeGrowth?.map(
                          (point: any, index: number) => {
                            const maxCount = Math.max(
                              ...(insightsData.employeeGrowth?.map(
                                (p: any) => p.count
                              ) || [1])
                            );
                            const heightPercentage =
                              maxCount > 0 ? (point.count / maxCount) * 100 : 0;
                            return (
                              <div key={index} className="chart-point">
                                <div
                                  className="growth-bar"
                                  style={{
                                    height: `${Math.max(heightPercentage, 8)}%`,
                                  }}
                                  title={`${point.date}: ${point.count} new employees`}
                                ></div>
                                <div className="chart-label">{point.date}</div>
                              </div>
                            );
                          }
                        )}
                      </div>
                    </div>

                    {/* Chart 3: Today's Attendance (Revamped) */}
                    <div className="chart-card kpi-attendance">
                      <div className="chart-header">
                        <h3 className="chart-title">Today's Attendance</h3>
                        {/* tiny date hint if you ever want to pass it from backend */}
                        <div className="attn-date-hint">
                          {new Date().toLocaleDateString()}
                        </div>
                      </div>

                      {(() => {
                        const ta = insightsData?.todayAttendance || {
                          present: 0,
                          absent: 0,
                          notMarked: 0,
                          total: 0,
                        };
                        const total = Math.max(0, Number(ta.total) || 0);
                        const present = Math.max(0, Number(ta.present) || 0);
                        const absent = Math.max(0, Number(ta.absent) || 0);
                        const notMarked = Math.max(
                          0,
                          Number(ta.notMarked) || 0
                        );

                        const pct =
                          total > 0 ? Math.round((present / total) * 100) : 0;

                        // segment angles (conic-gradient expects degrees). Keep order Present → Absent → Not Marked
                        const degPresent =
                          total > 0 ? (present / total) * 360 : 0;
                        const degAbsent =
                          total > 0 ? (absent / total) * 360 : 0;
                        const degNot = 360 - (degPresent + degAbsent);

                        // cumulative stops
                        const stop1 = degPresent;
                        const stop2 = degPresent + degAbsent;
                        const stop3 = 360; // remainder

                        return (
                          <div className="attn-body">
                            {/* Multi-segment donut with animated sweep */}
                            <div
                              className="donut-wrap"
                              role="img"
                              aria-label={`Present ${present}, Absent ${absent}, Not marked ${notMarked}, total ${total}`}
                            >
                              <div
                                className="donut-multi"
                                style={{
                                  background: `conic-gradient(
                #10b981 0deg ${stop1}deg,
                #ef4444 ${stop1}deg ${stop2}deg,
                #e5e7eb ${stop2}deg ${stop3}deg
              )`,
                                }}
                              >
                                <div className="donut-hole">
                                  <div className="donut-main">{pct}%</div>
                                  <div className="donut-sub">Present</div>
                                </div>
                                <div
                                  className="donut-sweep"
                                  aria-hidden="true"
                                />
                              </div>

                              {/* ring glow and tick marks */}
                              <div className="donut-glow" aria-hidden="true" />
                              <div className="donut-ticks" aria-hidden="true">
                                {Array.from({ length: 12 }).map((_, i) => (
                                  <span
                                    key={i}
                                    style={{
                                      transform: `rotate(${
                                        i * 30
                                      }deg) translateY(-58px)`,
                                    }}
                                  />
                                ))}
                              </div>
                            </div>

                            {/* Legend chips */}
                            <div className="attn-legend">
                              <div className="legend-chip present">
                                <span className="legend-dot" />
                                <span className="legend-label">Present</span>
                                <span className="legend-count">{present}</span>
                              </div>
                              <div className="legend-chip absent">
                                <span className="legend-dot" />
                                <span className="legend-label">Absent</span>
                                <span className="legend-count">{absent}</span>
                              </div>
                              <div className="legend-chip not">
                                <span className="legend-dot" />
                                <span className="legend-label">Not Marked</span>
                                <span className="legend-count">
                                  {notMarked}
                                </span>
                              </div>
                              <div className="legend-chip total">
                                <span className="legend-dot" />
                                <span className="legend-label">Total</span>
                                <span className="legend-count">{total}</span>
                              </div>
                            </div>

                            {/* Thin progress bar for present% */}
                            <div className="attn-progress" aria-hidden="true">
                              <div
                                className="attn-progress-fill"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Chart 4: Monthly Attendance Trend */}
                    <div className="chart-card wide">
                      <div className="chart-header">
                        <h3 className="chart-title">
                          Attendance Trend (14 Days)
                        </h3>
                        <svg
                          className="chart-icon"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path d="M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z" />
                          <path d="M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z" />
                        </svg>
                      </div>
                      <div className="trend-chart">
                        {insightsData.monthlyTrend?.map(
                          (day: any, index: number) => (
                            <div key={index} className="trend-day">
                              <div className="trend-bars">
                                <div
                                  className="trend-bar present-bar"
                                  style={{
                                    height: `${Math.max(
                                      day.present * 10,
                                      5
                                    )}px`,
                                  }}
                                  title={`${day.date}: ${day.present} present`}
                                ></div>
                                <div
                                  className="trend-bar absent-bar"
                                  style={{
                                    height: `${Math.max(day.absent * 10, 5)}px`,
                                  }}
                                  title={`${day.date}: ${day.absent} absent`}
                                ></div>
                              </div>
                              <div className="trend-label">{day.date}</div>
                              <div className="trend-rate">{day.rate}%</div>
                            </div>
                          )
                        )}
                      </div>
                    </div>

                    {/* Chart 5: Employee Activity Status */}
                    <div className="chart-card">
                      <div className="chart-header">
                        <h3 className="chart-title">Employee Activity</h3>
                        <svg
                          className="chart-icon"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zM4 7h12v9H4V7z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>
                      <div className="activity-chart">
                        <div className="activity-bars">
                          <div className="activity-bar">
                            <div
                              className="bar-fill active"
                              style={{
                                height: `${
                                  insightsData.employeeStatus
                                    ? (insightsData.employeeStatus.active /
                                        insightsData.totalEmployees) *
                                      100
                                    : 0
                                }%`,
                              }}
                            ></div>
                            <div className="bar-label">Active</div>
                            <div className="bar-value">
                              {insightsData.employeeStatus?.active || 0}
                            </div>
                          </div>
                          <div className="activity-bar">
                            <div
                              className="bar-fill inactive"
                              style={{
                                height: `${
                                  insightsData.employeeStatus
                                    ? (insightsData.employeeStatus.inactive /
                                        insightsData.totalEmployees) *
                                      100
                                    : 0
                                }%`,
                              }}
                            ></div>
                            <div className="bar-label">Inactive</div>
                            <div className="bar-value">
                              {insightsData.employeeStatus?.inactive || 0}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Chart 6: Weekly Attendance Pattern */}
                    <div className="chart-card">
                      <div className="chart-header">
                        <h3 className="chart-title">Weekly Pattern</h3>
                        <svg
                          className="chart-icon"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
                        </svg>
                      </div>
                      <div className="weekly-chart">
                        {insightsData.weeklyPattern?.map(
                          (day: any, index: number) => (
                            <div key={index} className="weekly-day">
                              <div
                                className="weekly-bar"
                                style={{
                                  height: `${Math.max(day.rate, 10)}%`,
                                  backgroundColor:
                                    day.rate > 80
                                      ? "#10b981"
                                      : day.rate > 60
                                      ? "#f59e0b"
                                      : "#ef4444",
                                }}
                                title={`${day.day}: ${day.rate}% attendance rate`}
                              ></div>
                              <div className="weekly-label">
                                {day.day.slice(0, 3)}
                              </div>
                              <div className="weekly-rate">{day.rate}%</div>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {err && (
                <div className="message error-message">
                  <span className="message-icon">⚠</span>
                  {err}
                </div>
              )}
            </div>
          )}

          {/* Employee Stats Tab */}
          {activeTab === "employee-stats" && (
            <div className="employee-stats-section">
              <div className="section-header">
                <h2 className="section-title">
                  Employee Performance Statistics
                </h2>
                <p className="section-subtitle">
                  Overview of employee attendance performance over the last 30
                  days
                </p>
                <button
                  className="refresh-button"
                  onClick={loadEmployeeStats}
                  disabled={employeeStatsLoading}
                >
                  <svg
                    className="refresh-icon"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Refresh Data
                </button>
              </div>

              {employeeStatsLoading ? (
                <div className="loading-container">
                  <div className="loader"></div>
                  <p>Loading employee statistics...</p>
                </div>
              ) : (
                <div className="stats-cards-container">
                  {/* Highest Presence Card */}
                  <div className="stat-card highest-presence">
                    <div className="stat-card-header">
                      <div className="stat-icon-container">
                        <svg
                          className="stat-icon"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>
                      <h3 className="stat-title">Highest Presence</h3>
                    </div>

                    {employeeStatsData.highestPresence ? (
                      <div className="stat-content">
                        <div className="employee-info">
                          <div className="employee-avatar">
                            <img
                              src="/icon-emp.png"
                              alt="Employee"
                              className="avatar-image"
                            />
                          </div>
                          <div className="employee-details">
                            <h4 className="employee-name">
                              {employeeStatsData.highestPresence.username}
                            </h4>
                            <p className="employee-email">
                              {employeeStatsData.highestPresence.email}
                            </p>
                          </div>
                        </div>

                        <div className="stat-metrics">
                          <div className="primary-metric">
                            <span className="metric-value">
                              {employeeStatsData.highestPresence.presenceRate}%
                            </span>
                            <span className="metric-label">
                              Attendance Rate
                            </span>
                          </div>

                          <div className="secondary-metrics">
                            <div className="metric-item">
                              <span className="metric-number">
                                {employeeStatsData.highestPresence.presentDays}
                              </span>
                              <span className="metric-text">Present Days</span>
                            </div>
                            <div className="metric-item">
                              <span className="metric-number">
                                {employeeStatsData.highestPresence.totalDays}
                              </span>
                              <span className="metric-text">Total Days</span>
                            </div>
                          </div>
                        </div>

                        <div className="progress-bar">
                          <div
                            className="progress-fill"
                            style={{
                              width: `${employeeStatsData.highestPresence.presenceRate}%`,
                            }}
                          ></div>
                        </div>
                      </div>
                    ) : (
                      <div className="no-data-message">
                        <p>No attendance data available</p>
                      </div>
                    )}
                  </div>

                  {/* Average Attendance Card */}
                  <div className="stat-card average-attendance">
                    <div className="stat-card-header">
                      <div className="stat-icon-container">
                        <svg
                          className="stat-icon"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <h3 className="stat-title">Average Attendance</h3>
                    </div>

                    <div className="stat-content">
                      <div className="primary-metric large">
                        <span className="metric-value">
                          {employeeStatsData.averageAttendance}%
                        </span>
                        <span className="metric-label">Overall Average</span>
                      </div>

                      <div className="secondary-metrics">
                        <div className="metric-item">
                          <span className="metric-number">
                            {employeeStatsData.totalActiveEmployees || 0}
                          </span>
                          <span className="metric-text">Active Employees</span>
                        </div>
                        <div className="metric-item">
                          <span className="metric-number">
                            {employeeStatsData.totalEmployees || 0}
                          </span>
                          <span className="metric-text">Total Employees</span>
                        </div>
                      </div>

                      <div className="progress-bar">
                        <div
                          className="progress-fill"
                          style={{
                            width: `${employeeStatsData.averageAttendance}%`,
                          }}
                        ></div>
                      </div>

                      <div className="stat-description">
                        <p>
                          Company-wide attendance average for the last 30 days
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Most Absents Card */}
                  <div className="stat-card most-absents">
                    <div className="stat-card-header">
                      <div className="stat-icon-container">
                        <svg
                          className="stat-icon"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>
                      <h3 className="stat-title">Most Absents</h3>
                    </div>

                    {employeeStatsData.mostAbsents ? (
                      <div className="stat-content">
                        <div className="employee-info">
                          <div className="employee-avatar">
                            <img
                              src="/icon-emp.png"
                              alt="Employee"
                              className="avatar-image"
                            />
                          </div>
                          <div className="employee-details">
                            <h4 className="employee-name">
                              {employeeStatsData.mostAbsents.username}
                            </h4>
                            <p className="employee-email">
                              {employeeStatsData.mostAbsents.email}
                            </p>
                          </div>
                        </div>

                        <div className="stat-metrics">
                          <div className="primary-metric">
                            <span className="metric-value">
                              {employeeStatsData.mostAbsents.absentDays}
                            </span>
                            <span className="metric-label">Absent Days</span>
                          </div>

                          <div className="secondary-metrics">
                            <div className="metric-item">
                              <span className="metric-number">
                                {employeeStatsData.mostAbsents.presenceRate}%
                              </span>
                              <span className="metric-text">
                                Attendance Rate
                              </span>
                            </div>
                            <div className="metric-item">
                              <span className="metric-number">
                                {employeeStatsData.mostAbsents.totalDays}
                              </span>
                              <span className="metric-text">Total Days</span>
                            </div>
                          </div>
                        </div>

                        <div className="progress-bar warning">
                          <div
                            className="progress-fill"
                            style={{
                              width: `${
                                (employeeStatsData.mostAbsents.absentDays /
                                  employeeStatsData.mostAbsents.totalDays) *
                                100
                              }%`,
                            }}
                          ></div>
                        </div>
                      </div>
                    ) : (
                      <div className="no-data-message">
                        <p>No attendance data available</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {err && (
                <div className="message error-message">
                  <span className="message-icon">⚠</span>
                  {err}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
