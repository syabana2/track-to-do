let tasks = [];
let activeTimers = {};
let tasksCreatedChart = null;
let tasksCompletedChart = null;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    loadTasks();
    loadDashboard();
});

// View management
function showView(viewName) {
    document.querySelectorAll('.view').forEach(view => view.style.display = 'none');
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    
    document.getElementById(`${viewName}-view`).style.display = 'block';
    event.target.classList.add('active');
    
    if (viewName === 'dashboard') {
        loadDashboard();
    } else if (viewName === 'kanban') {
        renderKanban();
    } else if (viewName === 'todo') {
        renderTodoList();
    }
}

// Load tasks from API
async function loadTasks() {
    try {
        const response = await fetch('/api/tasks');
        tasks = await response.json();
        populateProjectFilter();
        renderTodoList();
        renderKanban();
    } catch (error) {
        console.error('Error loading tasks:', error);
    }
}

// Render Todo List
function renderTodoList() {
    const todoList = document.getElementById('todo-list');
    todoList.innerHTML = '';
    
    // Apply filters
    let filteredTasks = getFilteredTasks();
    
    if (filteredTasks.length === 0) {
        todoList.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 40px;">No tasks found.</p>';
        return;
    }
    
    // Group tasks by date
    const groupedTasks = groupTasksByDate(filteredTasks);
    
    // Render each date group
    Object.keys(groupedTasks).sort((a, b) => {
        if (a === 'No Due Date') return 1;
        if (b === 'No Due Date') return -1;
        if (a === '🔴 Overdue') return -1;
        if (b === '🔴 Overdue') return 1;
        if (a === '📅 Today') return -1;
        if (b === '📅 Today') return 1;
        if (a === '📅 Tomorrow') return -1;
        if (b === '📅 Tomorrow') return 1;
        return new Date(a) - new Date(b);
    }).forEach(dateKey => {
        const dateGroup = document.createElement('div');
        dateGroup.className = 'date-group';
        
        const dateHeader = document.createElement('div');
        dateHeader.className = 'date-header';
        dateHeader.textContent = `${dateKey} (${groupedTasks[dateKey].length})`;
        dateGroup.appendChild(dateHeader);
        
        // Sort tasks by priority within each date group (high -> medium -> low)
        const priorityOrder = { 'high': 1, 'medium': 2, 'low': 3 };
        groupedTasks[dateKey].sort((a, b) => {
            return priorityOrder[a.priority || 'medium'] - priorityOrder[b.priority || 'medium'];
        }).forEach(task => {
            const taskEl = createTaskElement(task);
            dateGroup.appendChild(taskEl);
        });
        
        todoList.appendChild(dateGroup);
    });
}

function groupTasksByDate(tasks) {
    const groups = {};
    
    tasks.forEach(task => {
        let dateKey = 'No Due Date';
        
        if (task.due_date) {
            const dueDate = new Date(task.due_date);
            const today = new Date();
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            
            // Reset time to compare only dates
            today.setHours(0, 0, 0, 0);
            tomorrow.setHours(0, 0, 0, 0);
            dueDate.setHours(0, 0, 0, 0);
            
            if (dueDate.getTime() === today.getTime()) {
                dateKey = '📅 Today';
            } else if (dueDate.getTime() === tomorrow.getTime()) {
                dateKey = '📅 Tomorrow';
            } else if (dueDate < today) {
                dateKey = '🔴 Overdue';
            } else {
                dateKey = formatDate(task.due_date);
            }
        }
        
        if (!groups[dateKey]) {
            groups[dateKey] = [];
        }
        groups[dateKey].push(task);
    });
    
    return groups;
}

function createTaskElement(task) {
    const taskEl = document.createElement('div');
    taskEl.className = `task-item status-${task.status} priority-${task.priority || 'medium'}`;
    
    const timeSpent = formatTime(task.time_spent);
    const isTimerActive = activeTimers[task.id];
    
    const priorityEmoji = {
        'low': '🟢',
        'medium': '🟡',
        'high': '🔴'
    };
    
    taskEl.innerHTML = `
        <div class="task-header">
            <div class="task-title">${task.title}</div>
            <div class="task-actions">
                <button class="task-btn" onclick="editTask(${task.id})" title="Edit">✏️</button>
                <button class="task-btn" onclick="deleteTask(${task.id})" title="Delete">🗑️</button>
            </div>
        </div>
        ${task.description ? `<div class="task-description">${task.description}</div>` : ''}
        <div class="task-meta">
            <span class="task-status status-${task.status}">${getStatusLabel(task.status)}</span>
            <span class="priority-badge priority-${task.priority || 'medium'}">${priorityEmoji[task.priority || 'medium']} ${capitalizeFirst(task.priority || 'medium')}</span>
            ${task.project ? `<span class="task-project">📁 ${task.project}</span>` : ''}
            <span>⏱️ ${timeSpent}</span>
        </div>
        <div class="timer-controls">
            ${!isTimerActive ? 
                `<button class="timer-btn timer-start" onclick="startTimer(${task.id})">▶️ Start Timer</button>` :
                `<button class="timer-btn timer-stop" onclick="stopTimer(${task.id})">⏹️ Stop Timer</button>`
            }
        </div>
    `;
    
    return taskEl;
}

// Render Kanban Board
function renderKanban() {
    const columns = {
        'todo': document.getElementById('kanban-todo'),
        'in-progress': document.getElementById('kanban-in-progress'),
        'done': document.getElementById('kanban-done')
    };
    
    Object.values(columns).forEach(col => col.innerHTML = '');
    
    tasks.forEach(task => {
        const card = document.createElement('div');
        card.className = 'kanban-card';
        card.draggable = true;
        card.dataset.taskId = task.id;
        
        card.innerHTML = `
            <div class="kanban-card-title">${task.title}</div>
            <div class="kanban-card-time">⏱️ ${formatTime(task.time_spent)}</div>
        `;
        
        card.addEventListener('dragstart', handleDragStart);
        card.addEventListener('click', () => editTask(task.id));
        
        columns[task.status].appendChild(card);
    });
    
    // Setup drop zones
    Object.entries(columns).forEach(([status, column]) => {
        column.addEventListener('dragover', handleDragOver);
        column.addEventListener('drop', (e) => handleDrop(e, status));
    });
}

// Drag and Drop handlers
let draggedTaskId = null;

function handleDragStart(e) {
    draggedTaskId = e.target.dataset.taskId;
    e.target.style.opacity = '0.4';
}

function handleDragOver(e) {
    e.preventDefault();
    return false;
}

async function handleDrop(e, newStatus) {
    e.stopPropagation();
    e.preventDefault();
    
    if (!draggedTaskId) return;
    
    const task = tasks.find(t => t.id == draggedTaskId);
    if (task && task.status !== newStatus) {
        task.status = newStatus;
        await updateTaskStatus(task.id, newStatus);
    }
    
    document.querySelector(`[data-task-id="${draggedTaskId}"]`).style.opacity = '1';
    draggedTaskId = null;
    
    return false;
}

// Load Dashboard stats
async function loadDashboard() {
    try {
        const response = await fetch('/api/dashboard/stats');
        const stats = await response.json();
        
        document.getElementById('stat-todo').textContent = stats.status_counts.todo || 0;
        document.getElementById('stat-in-progress').textContent = stats.status_counts['in-progress'] || 0;
        document.getElementById('stat-done').textContent = stats.status_counts.done || 0;
        document.getElementById('stat-completed-today').textContent = stats.completed_today;
        document.getElementById('stat-total-time').textContent = formatTime(stats.total_time);
        document.getElementById('stat-avg-time').textContent = formatTime(Math.round(stats.average_time));
        
        // Render charts
        renderTasksCreatedChart(stats.daily_created);
        renderTasksCompletedChart(stats.daily_completion);
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

// Render Tasks Created Chart
function renderTasksCreatedChart(dailyData) {
    const ctx = document.getElementById('tasks-created-chart');
    if (!ctx) return;
    
    // Destroy existing chart
    if (tasksCreatedChart) {
        tasksCreatedChart.destroy();
    }
    
    // Prepare data for last 7 days
    const last7Days = getLast7Days();
    const priorities = ['high', 'medium', 'low'];
    const datasets = [];
    
    const colors = {
        'high': 'rgba(239, 68, 68, 1)',
        'medium': 'rgba(245, 158, 11, 1)',
        'low': 'rgba(16, 185, 129, 1)'
    };
    
    const bgColors = {
        'high': 'rgba(239, 68, 68, 0.1)',
        'medium': 'rgba(245, 158, 11, 0.1)',
        'low': 'rgba(16, 185, 129, 0.1)'
    };
    
    priorities.forEach(priority => {
        const data = last7Days.map(date => {
            const found = dailyData.find(d => d.date === date && d.priority === priority);
            return found ? found.count : 0;
        });
        
        datasets.push({
            label: priority.charAt(0).toUpperCase() + priority.slice(1) + ' Priority',
            data: data,
            borderColor: colors[priority],
            backgroundColor: bgColors[priority],
            tension: 0.4,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 6
        });
    });
    
    tasksCreatedChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: last7Days.map(d => formatChartDate(d)),
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        color: '#e4e4e7',
                        padding: 15,
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(26, 26, 46, 0.95)',
                    titleColor: '#e4e4e7',
                    bodyColor: '#e4e4e7',
                    borderColor: '#6366f1',
                    borderWidth: 1
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: '#a1a1aa',
                        stepSize: 1
                    },
                    grid: {
                        color: 'rgba(39, 39, 42, 0.5)'
                    }
                },
                x: {
                    ticks: {
                        color: '#a1a1aa'
                    },
                    grid: {
                        color: 'rgba(39, 39, 42, 0.5)'
                    }
                }
            }
        }
    });
}

// Render Tasks Completed Chart
function renderTasksCompletedChart(dailyData) {
    const ctx = document.getElementById('tasks-completed-chart');
    if (!ctx) return;
    
    // Destroy existing chart
    if (tasksCompletedChart) {
        tasksCompletedChart.destroy();
    }
    
    // Prepare data for last 7 days
    const last7Days = getLast7Days();
    const priorities = ['high', 'medium', 'low'];
    const datasets = [];
    
    const colors = {
        'high': 'rgba(239, 68, 68, 1)',
        'medium': 'rgba(245, 158, 11, 1)',
        'low': 'rgba(16, 185, 129, 1)'
    };
    
    const bgColors = {
        'high': 'rgba(239, 68, 68, 0.1)',
        'medium': 'rgba(245, 158, 11, 0.1)',
        'low': 'rgba(16, 185, 129, 0.1)'
    };
    
    priorities.forEach(priority => {
        const data = last7Days.map(date => {
            const found = dailyData.find(d => d.date === date && d.priority === priority);
            return found ? found.count : 0;
        });
        
        datasets.push({
            label: priority.charAt(0).toUpperCase() + priority.slice(1) + ' Priority',
            data: data,
            borderColor: colors[priority],
            backgroundColor: bgColors[priority],
            tension: 0.4,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 6
        });
    });
    
    tasksCompletedChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: last7Days.map(d => formatChartDate(d)),
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: {
                        color: '#e4e4e7',
                        padding: 15,
                        font: {
                            size: 12
                        }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(26, 26, 46, 0.95)',
                    titleColor: '#e4e4e7',
                    bodyColor: '#e4e4e7',
                    borderColor: '#6366f1',
                    borderWidth: 1
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: '#a1a1aa',
                        stepSize: 1
                    },
                    grid: {
                        color: 'rgba(39, 39, 42, 0.5)'
                    }
                },
                x: {
                    ticks: {
                        color: '#a1a1aa'
                    },
                    grid: {
                        color: 'rgba(39, 39, 42, 0.5)'
                    }
                }
            }
        }
    });
}

// Get last 7 days in YYYY-MM-DD format
function getLast7Days() {
    const dates = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        dates.push(date.toISOString().split('T')[0]);
    }
    return dates;
}

// Format date for chart labels
function formatChartDate(dateString) {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Reset time for comparison
    today.setHours(0, 0, 0, 0);
    yesterday.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);
    
    if (date.getTime() === today.getTime()) {
        return 'Today';
    } else if (date.getTime() === yesterday.getTime()) {
        return 'Yesterday';
    } else {
        const options = { month: 'short', day: 'numeric' };
        return date.toLocaleDateString('en-US', options);
    }
}

// Modal management
function openAddTaskModal() {
    document.getElementById('modal-title').textContent = 'Add New Task';
    document.getElementById('task-form').reset();
    document.getElementById('task-id').value = '';
    
    // Set default due date to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('task-due-date').value = today;
    
    document.getElementById('task-modal').style.display = 'block';
}

function editTask(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    document.getElementById('modal-title').textContent = 'Edit Task';
    document.getElementById('task-id').value = task.id;
    document.getElementById('task-title').value = task.title;
    document.getElementById('task-description').value = task.description || '';
    document.getElementById('task-status').value = task.status;
    document.getElementById('task-priority').value = task.priority || 'medium';
    document.getElementById('task-project').value = task.project || '';
    document.getElementById('task-due-date').value = task.due_date || '';
    document.getElementById('task-modal').style.display = 'block';
}

function closeModal() {
    document.getElementById('task-modal').style.display = 'none';
}

// Task CRUD operations
async function saveTask(event) {
    event.preventDefault();
    
    const taskId = document.getElementById('task-id').value;
    const title = document.getElementById('task-title').value;
    const description = document.getElementById('task-description').value;
    const status = document.getElementById('task-status').value;
    const priority = document.getElementById('task-priority').value;
    const project = document.getElementById('task-project').value;
    const dueDate = document.getElementById('task-due-date').value;
    
    const taskData = { 
        title, 
        description, 
        status, 
        priority, 
        project,
        due_date: dueDate || null
    };
    
    try {
        if (taskId) {
            await fetch(`/api/tasks/${taskId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(taskData)
            });
        } else {
            await fetch('/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(taskData)
            });
        }
        
        closeModal();
        await loadTasks();
    } catch (error) {
        console.error('Error saving task:', error);
        alert('Error saving task');
    }
}

async function deleteTask(taskId) {
    if (!confirm('Are you sure you want to delete this task?')) return;
    
    try {
        await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
        await loadTasks();
    } catch (error) {
        console.error('Error deleting task:', error);
        alert('Error deleting task');
    }
}

async function updateTaskStatus(taskId, newStatus) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    try {
        await fetch(`/api/tasks/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: task.title,
                description: task.description,
                status: newStatus,
                priority: task.priority || 'medium',
                project: task.project || '',
                due_date: task.due_date || null
            })
        });
        await loadTasks();
    } catch (error) {
        console.error('Error updating task status:', error);
    }
}

// Timer management
async function startTimer(taskId) {
    try {
        await fetch(`/api/tasks/${taskId}/start-timer`, { method: 'POST' });
        activeTimers[taskId] = true;
        renderTodoList();
    } catch (error) {
        console.error('Error starting timer:', error);
        alert('Error starting timer');
    }
}

async function stopTimer(taskId) {
    try {
        await fetch(`/api/tasks/${taskId}/stop-timer`, { method: 'POST' });
        delete activeTimers[taskId];
        await loadTasks();
    } catch (error) {
        console.error('Error stopping timer:', error);
        alert('Error stopping timer');
    }
}

// Utility functions
function formatTime(seconds) {
    if (!seconds) return '0m';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
}

function getStatusLabel(status) {
    const labels = {
        'todo': 'Todo',
        'in-progress': 'In Progress',
        'done': 'Done'
    };
    return labels[status] || status;
}

function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const options = { weekday: 'short', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

// Filter functions
function getFilteredTasks() {
    const projectFilter = document.getElementById('filter-project')?.value || '';
    const priorityFilter = document.getElementById('filter-priority')?.value || '';
    const statusFilter = document.getElementById('filter-status')?.value || '';
    
    return tasks.filter(task => {
        if (projectFilter && task.project !== projectFilter) return false;
        if (priorityFilter && task.priority !== priorityFilter) return false;
        if (statusFilter && task.status !== statusFilter) return false;
        return true;
    });
}

function populateProjectFilter() {
    const projectFilter = document.getElementById('filter-project');
    if (!projectFilter) return;
    
    // Get unique projects
    const projects = [...new Set(tasks.map(t => t.project).filter(p => p))];
    
    // Save current selection
    const currentValue = projectFilter.value;
    
    // Clear and repopulate
    projectFilter.innerHTML = '<option value="">All Projects</option>';
    projects.sort().forEach(project => {
        const option = document.createElement('option');
        option.value = project;
        option.textContent = `📁 ${project}`;
        projectFilter.appendChild(option);
    });
    
    // Restore selection
    projectFilter.value = currentValue;
}

function applyFilters() {
    renderTodoList();
}

function clearFilters() {
    document.getElementById('filter-project').value = '';
    document.getElementById('filter-priority').value = '';
    document.getElementById('filter-status').value = '';
    renderTodoList();
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('task-modal');
    if (event.target === modal) {
        closeModal();
    }
}
