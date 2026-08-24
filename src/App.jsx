import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import "./App.css";

const TABLE_NAME = "todos";

export default function App() {
  const [todos, setTodos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  
  // Controls & States
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [viewMode, setViewMode] = useState("table"); // 'table' | 'kanban'
  const [theme, setTheme] = useState("dark");
  const [selectedIds, setSelectedIds] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });
  const [editingCell, setEditingCell] = useState(null); // { id, field }

  // Modal State
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingTodo, setEditingTodo] = useState(null);
  const emptyForm = {
    task: "",
    description: "",
    category: "General",
    assigned_to: "",
    priority: "Medium",
    status: "Pending",
    due_date: "",
    estimated_hours: "",
  };
  const [formData, setFormData] = useState(emptyForm);

  // 1. READ & REALTIME LISTENERS
  async function fetchTodos() {
    setLoading(true);
    const { data, error } = await supabase.from(TABLE_NAME).select("*");
    if (error) setErrorMessage(error.message);
    else setTodos(data || []);
    setLoading(false);
  }

  useEffect(() => {
    fetchTodos();

    // Enable Supabase Realtime WebSocket listener
    const channel = supabase
      .channel("schema-db-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE_NAME }, () => {
        fetchTodos();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Theme Toggler
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // 2. CSV EXPORT
  function exportToCSV() {
    const headers = ["ID", "Task", "Category", "Assigned To", "Priority", "Status", "Due Date"];
    const rows = filteredTodos.map(t => [
      t.id || "",
      `"${t.task}"`,
      `"${t.category || ""}"`,
      `"${t.assigned_to || ""}"`,
      t.priority || "",
      t.status || "",
      t.due_date || ""
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `tasks_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // 3. BULK ACTIONS
  async function handleBulkDelete() {
    if (!window.confirm(`Delete ${selectedIds.length} selected tasks?`)) return;
    const { error } = await supabase.from(TABLE_NAME).delete().in("id", selectedIds);
    if (!error) {
      setTodos((prev) => prev.filter((t) => !selectedIds.includes(t.id)));
      setSelectedIds([]);
    }
  }

  // 4. INLINE & STATUS UPDATES
  async function handleStatusChange(todo, newStatus) {
    const isCompleted = newStatus === "Completed";
    const matchField = todo.id ? "id" : "task";
    const matchVal = todo.id || todo.task;

    setTodos((prev) =>
      prev.map((t) => ((t.id && t.id === todo.id) || t.task === todo.task ? { ...t, status: newStatus, completed: isCompleted } : t))
    );

    await supabase.from(TABLE_NAME).update({ status: newStatus, completed: isCompleted }).eq(matchField, matchVal);
  }

  async function handleInlineSave(todo, field, value) {
    setEditingCell(null);
    const matchField = todo.id ? "id" : "task";
    const matchVal = todo.id || todo.task;
    await supabase.from(TABLE_NAME).update({ [field]: value }).eq(matchField, matchVal);
    fetchTodos();
  }

  // 5. SORTING & FILTERS
  function requestSort(key) {
    let direction = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc") direction = "desc";
    setSortConfig({ key, direction });
  }

  const categories = ["All", ...new Set(todos.map((t) => t.category).filter(Boolean))];
  
  let processedTodos = todos.filter((todo) => {
    const text = Object.values(todo).join(" ").toLowerCase();
    const matchesSearch = text.includes(searchTerm.toLowerCase());
    const matchesCategory = categoryFilter === "All" || todo.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  if (sortConfig.key) {
    processedTodos.sort((a, b) => {
      const aVal = a[sortConfig.key] || "";
      const bVal = b[sortConfig.key] || "";
      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
  }

  const filteredTodos = processedTodos;
  const completedCount = todos.filter((t) => t.completed || t.status === "Completed").length;
  const progressPercent = todos.length ? Math.round((completedCount / todos.length) * 100) : 0;
  const todayStr = new Date().toISOString().split("T")[0];

  // Forms
  async function handleCreateTask(e) {
    e.preventDefault();
    const payload = { ...formData, completed: formData.status === "Completed" };
    const { data, error } = await supabase.from(TABLE_NAME).insert([payload]).select();
    if (!error) {
      if (data) setTodos((prev) => [data[0], ...prev]);
      setIsAddOpen(false);
      setFormData(emptyForm);
    }
  }

  async function handleDelete(todo) {
    if (!window.confirm("Delete task?")) return;
    const matchField = todo.id ? "id" : "task";
    const matchVal = todo.id || todo.task;
    setTodos((prev) => prev.filter((t) => (t.id || t.task) !== matchVal));
    await supabase.from(TABLE_NAME).delete().eq(matchField, matchVal);
  }

  return (
    <div className="portal-container">
      {/* Header */}
      <div className="top-header">
        <div>
          <h1 style={{ margin: 0 }}>Task Portal</h1>
          <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
            Realtime database workspace • {todos.length} Active Tasks
          </span>
        </div>
        <div className="header-actions">
          <button className="action-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
          </button>
          <button className="action-btn" onClick={exportToCSV}>📥 Export CSV</button>
          <button className="btn-primary" onClick={() => { setFormData(emptyForm); setIsAddOpen(true); }}>
            + Add Task
          </button>
        </div>
      </div>

      {/* Completion Tracker Progress Bar */}
      <div className="progress-container">
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", fontWeight: 600 }}>
          <span>Overall Workspace Progress</span>
          <span>{progressPercent}% Complete ({completedCount}/{todos.length})</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      {/* Control Bar */}
      <div className="control-bar">
        <div style={{ display: "flex", gap: "0.25rem" }}>
          <button className={`action-btn ${viewMode === "table" ? "active" : ""}`} onClick={() => setViewMode("table")}>
            📄 Table
          </button>
          <button className={`action-btn ${viewMode === "kanban" ? "active" : ""}`} onClick={() => setViewMode("kanban")}>
            📋 Kanban
          </button>
        </div>

        <input
          type="text"
          className="search-field"
          placeholder="Search task details..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />

        <select className="select-filter" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          {categories.map((c) => (<option key={c} value={c}>{c}</option>))}
        </select>

        {selectedIds.length > 0 && (
          <button className="action-btn" onClick={handleBulkDelete} style={{ color: "#ef4444", borderColor: "#ef4444" }}>
            🗑️ Delete Selected ({selectedIds.length})
          </button>
        )}
      </div>

      {/* KANBAN VIEW */}
      {viewMode === "kanban" && (
        <div className="kanban-board">
          {["Pending", "In Progress", "Completed"].map((colStatus) => (
            <div key={colStatus} className="kanban-column">
              <div className="kanban-header">
                <span>{colStatus}</span>
                <span>{filteredTodos.filter((t) => (t.status || "Pending") === colStatus).length}</span>
              </div>
              {filteredTodos
                .filter((t) => (t.status || "Pending") === colStatus)
                .map((todo) => (
                  <div key={todo.id || todo.task} className="kanban-card">
                    <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>{todo.task}</div>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                      {todo.category || "General"} • {todo.assigned_to || "Unassigned"}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span className={`priority-badge priority-${(todo.priority || "medium").toLowerCase()}`}>
                        {todo.priority}
                      </span>
                      <select
                        className="inline-select"
                        value={todo.status || "Pending"}
                        onChange={(e) => handleStatusChange(todo, e.target.value)}
                      >
                        <option value="Pending">Pending</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Completed">Completed</option>
                      </select>
                    </div>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}

      {/* TABLE VIEW */}
      {viewMode === "table" && (
        <div className="table-wrapper">
          <table className="custom-table">
            <thead>
              <tr>
                <th style={{ width: "30px" }}>
                  <input
                    type="checkbox"
                    onChange={(e) =>
                      setSelectedIds(e.target.checked ? filteredTodos.map((t) => t.id) : [])
                    }
                  />
                </th>
                <th style={{ cursor: "pointer" }} onClick={() => requestSort("task")}>
                  Task Title {sortConfig.key === "task" ? (sortConfig.direction === "asc" ? "▲" : "▼") : ""}
                </th>
                <th style={{ cursor: "pointer" }} onClick={() => requestSort("category")}>
                  Category {sortConfig.key === "category" ? (sortConfig.direction === "asc" ? "▲" : "▼") : ""}
                </th>
                <th>Assigned To</th>
                <th style={{ cursor: "pointer" }} onClick={() => requestSort("priority")}>
                  Priority {sortConfig.key === "priority" ? (sortConfig.direction === "asc" ? "▲" : "▼") : ""}
                </th>
                <th>Status</th>
                <th style={{ cursor: "pointer" }} onClick={() => requestSort("due_date")}>
                  Due Date {sortConfig.key === "due_date" ? (sortConfig.direction === "asc" ? "▲" : "▼") : ""}
                </th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTodos.map((todo) => {
                const isDone = todo.status === "Completed" || todo.completed;
                const isOverdue = todo.due_date && todo.due_date < todayStr && !isDone;

                return (
                  <tr key={todo.id || todo.task}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(todo.id)}
                        onChange={(e) => {
                          setSelectedIds((prev) =>
                            e.target.checked ? [...prev, todo.id] : prev.filter((id) => id !== todo.id)
                          );
                        }}
                      />
                    </td>
                    {/* Double-Click Cell for Inline Text Edit */}
                    <td onDoubleClick={() => setEditingCell({ id: todo.id, field: "task" })}>
                      {editingCell?.id === todo.id && editingCell?.field === "task" ? (
                        <input
                          autoFocus
                          className="search-field"
                          defaultValue={todo.task}
                          onBlur={(e) => handleInlineSave(todo, "task", e.target.value)}
                        />
                      ) : (
                        <div style={{ textDecoration: isDone ? "line-through" : "none" }}>{todo.task}</div>
                      )}
                    </td>
                    <td>{todo.category || "General"}</td>
                    <td>{todo.assigned_to || "Unassigned"}</td>
                    <td>
                      <span className={`priority-badge priority-${(todo.priority || "medium").toLowerCase()}`}>
                        {todo.priority || "Medium"}
                      </span>
                    </td>
                    <td>
                      <select
                        className="inline-select"
                        value={todo.status || (isDone ? "Completed" : "Pending")}
                        onChange={(e) => handleStatusChange(todo, e.target.value)}
                      >
                        <option value="Pending">Pending</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Completed">Completed</option>
                      </select>
                    </td>
                    <td className={isOverdue ? "overdue-date" : ""}>
                      {todo.due_date || "-"} {isOverdue && "⚠️"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button className="action-btn" onClick={() => handleDelete(todo)}>🗑️</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Task Creation Modal */}
      {isAddOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "var(--panel-bg)", padding: "2rem", borderRadius: "8px", width: "450px" }}>
            <h2>Add New Task</h2>
            <form onSubmit={handleCreateTask}>
              <div style={{ marginBottom: "1rem" }}>
                <label>Task Title</label>
                <input
                  required
                  className="search-field"
                  style={{ width: "100%", boxSizing: "border-box" }}
                  value={formData.task}
                  onChange={(e) => setFormData({ ...formData, task: e.target.value })}
                />
              </div>
              <div style={{ marginBottom: "1rem" }}>
                <label>Due Date</label>
                <input
                  type="date"
                  className="search-field"
                  style={{ width: "100%", boxSizing: "border-box" }}
                  value={formData.due_date}
                  onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                <button type="button" className="action-btn" onClick={() => setIsAddOpen(false)}>Cancel</button>
                <button type="submit" className="btn-primary">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}