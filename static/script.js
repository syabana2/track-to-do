let tasks = [];
let activeTimers = {};
let tasksCreatedChart = null;
let tasksCompletedChart = null;
let credentials = [];

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
    } else if (viewName === 'credentials') {
        loadCredentials();
    }
}

// Load tasks from API
async function loadTasks() {
    try {
        const response = await fetch('/api/tasks');
        tasks = await response.json();
        await loadProjects();
        populateProjectFilter();
        renderTodoList();
        renderKanban();
    } catch (error) {
        console.error('Error loading tasks:', error);
    }
}

// Load projects for autocomplete
async function loadProjects() {
    try {
        const response = await fetch('/api/projects');
        const projects = await response.json();

        const datalist = document.getElementById('project-list');
        if (datalist) {
            datalist.innerHTML = '';
            projects.forEach(project => {
                const option = document.createElement('option');
                option.value = project;
                datalist.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading projects:', error);
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
        let dateKey = 'No Date';

        if (task.created_at) {
            const createdDate = new Date(task.created_at);
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);

            // Reset time to compare only dates
            today.setHours(0, 0, 0, 0);
            yesterday.setHours(0, 0, 0, 0);
            createdDate.setHours(0, 0, 0, 0);

            if (createdDate.getTime() === today.getTime()) {
                dateKey = '📅 Created Today';
            } else if (createdDate.getTime() === yesterday.getTime()) {
                dateKey = '📅 Created Yesterday';
            } else {
                dateKey = '📅 Created on ' + formatDate(task.created_at);
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
    const isOverdue = checkIfOverdue(task);
    taskEl.className = `task-item status-${task.status} priority-${task.priority || 'medium'}${isOverdue ? ' overdue' : ''}`;
    taskEl.dataset.taskId = task.id;

    const timeSpent = formatTime(task.time_spent);
    const isTimerActive = activeTimers[task.id];

    const priorityEmoji = {
        'low': '🟢',
        'medium': '🟡',
        'high': '🔴'
    };

    const overdueBadge = isOverdue ? '<span class="overdue-badge">⚠️ Overdue</span>' : '';

    taskEl.innerHTML = `
        ${overdueBadge}
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
            <span class="task-time-display">⏱️ ${timeSpent}</span>
        </div>
        <div class="task-dates">
            ${task.created_at ? `<span class="task-date-item">📅 Created: ${formatDateShort(task.created_at)}</span>` : ''}
            ${task.due_date ? `<span class="task-date-item" ${isOverdue ? 'style="color: var(--danger); font-weight: 600;"' : ''}>⏰ Due: ${formatDateShort(task.due_date)}</span>` : ''}
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

    // Apply filters
    const filteredTasks = getFilteredTasks();

    filteredTasks.forEach(task => {
        const card = document.createElement('div');
        const isOverdue = checkIfOverdue(task);
        card.className = `kanban-card priority-${task.priority || 'medium'}${isOverdue ? ' overdue' : ''}`;
        card.draggable = true;
        card.dataset.taskId = task.id;

        const priorityEmoji = {
            'low': '🟢',
            'medium': '🟡',
            'high': '🔴'
        };

        const isTimerActive = activeTimers[task.id];

        card.innerHTML = `
            <div class="kanban-card-title">${task.title}</div>
            <div class="kanban-card-meta">
                <div class="kanban-card-row">
                    <span>${priorityEmoji[task.priority || 'medium']} ${capitalizeFirst(task.priority || 'medium')}</span>
                    ${isOverdue ? '<span class="kanban-overdue-badge">⚠️ Overdue</span>' : ''}
                </div>
                ${task.project ? `<div class="kanban-card-project">📁 ${task.project}</div>` : ''}
                <div class="kanban-card-row">
                    ${task.created_at ? `<span>📅 ${formatDateShort(task.created_at)}</span>` : ''}
                    ${task.due_date ? `<span style="${isOverdue ? 'color: var(--danger); font-weight: 600;' : ''}">⏰ ${formatDateShort(task.due_date)}</span>` : ''}
                </div>
            </div>
            <div class="kanban-card-time">⏱️ ${formatTime(task.time_spent)}</div>
            <div class="kanban-timer-controls">
                ${!isTimerActive ?
                    `<button class="kanban-timer-btn kanban-timer-start" onclick="event.stopPropagation(); startTimer(${task.id})">▶️ Start</button>` :
                    `<button class="kanban-timer-btn kanban-timer-stop" onclick="event.stopPropagation(); stopTimer(${task.id})">⏹️ Stop</button>`
                }
            </div>
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

        // Apply filters to stats
        const filteredTasks = getFilteredTasks();
        const filteredStatusCounts = {
            'todo': filteredTasks.filter(t => t.status === 'todo').length,
            'in-progress': filteredTasks.filter(t => t.status === 'in-progress').length,
            'done': filteredTasks.filter(t => t.status === 'done').length
        };

        const filteredTotalTime = filteredTasks.reduce((sum, t) => sum + (t.time_spent || 0), 0);
        const tasksWithTime = filteredTasks.filter(t => t.time_spent > 0);
        const filteredAvgTime = tasksWithTime.length > 0
            ? tasksWithTime.reduce((sum, t) => sum + t.time_spent, 0) / tasksWithTime.length
            : 0;

        const today = new Date().toISOString().split('T')[0];
        const filteredCompletedToday = filteredTasks.filter(t =>
            t.completed_at && t.completed_at.startsWith(today)
        ).length;

        document.getElementById('stat-todo').textContent = filteredStatusCounts.todo;
        document.getElementById('stat-in-progress').textContent = filteredStatusCounts['in-progress'];
        document.getElementById('stat-done').textContent = filteredStatusCounts.done;
        document.getElementById('stat-completed-today').textContent = filteredCompletedToday;
        document.getElementById('stat-total-time').textContent = formatTime(filteredTotalTime);
        document.getElementById('stat-avg-time').textContent = formatTime(Math.round(filteredAvgTime));

        // Render charts with filtered data
        const filteredDailyCreated = filterDailyData(stats.daily_created, filteredTasks);
        const filteredDailyCompletion = filterDailyData(stats.daily_completion, filteredTasks);

        renderTasksCreatedChart(filteredDailyCreated);
        renderTasksCompletedChart(filteredDailyCompletion);
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

// Filter daily data based on current filters
function filterDailyData(dailyData, filteredTasks) {
    const filteredTaskIds = new Set(filteredTasks.map(t => t.id));
    // Since we don't have task IDs in daily data, we filter by priority
    const projectFilter = document.getElementById('filter-project')?.value || '';
    const priorityFilter = document.getElementById('filter-priority')?.value || '';
    const statusFilter = document.getElementById('filter-status')?.value || '';

    if (!projectFilter && !priorityFilter && !statusFilter) {
        return dailyData;
    }

    return dailyData.filter(item => {
        if (priorityFilter && item.priority !== priorityFilter) return false;
        return true;
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

    // Set default dates
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('task-created-date').value = today;
    document.getElementById('task-due-date').value = today;

    document.getElementById('task-modal').style.display = 'block';
}

function editTask(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    // Reset form first to clear any previous data
    document.getElementById('task-form').reset();

    document.getElementById('modal-title').textContent = 'Edit Task';
    document.getElementById('task-id').value = task.id;
    document.getElementById('task-title').value = task.title;
    document.getElementById('task-description').value = task.description || '';
    document.getElementById('task-status').value = task.status;
    document.getElementById('task-priority').value = task.priority || 'medium';
    document.getElementById('task-project').value = task.project || '';
    document.getElementById('task-created-date').value = task.created_at ? task.created_at.split(' ')[0] : '';
    document.getElementById('task-due-date').value = task.due_date || '';
    document.getElementById('task-modal').style.display = 'block';
}

function closeModal() {
    document.getElementById('task-modal').style.display = 'none';
    document.getElementById('task-form').reset();
    document.getElementById('task-id').value = '';
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
    const createdDate = document.getElementById('task-created-date').value;
    const dueDate = document.getElementById('task-due-date').value;

    const taskData = {
        title,
        description,
        status,
        priority,
        project,
        created_at: createdDate || null,
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
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to save task',
            confirmButtonColor: '#6366f1'
        });
    }
}

async function deleteTask(taskId) {
    const result = await Swal.fire({
        title: 'Are you sure?',
        text: "You won't be able to revert this!",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'Yes, delete it!'
    });

    if (!result.isConfirmed) return;

    try {
        await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
        await loadTasks();
        Swal.fire({
            icon: 'success',
            title: 'Deleted!',
            text: 'Task has been deleted.',
            confirmButtonColor: '#6366f1',
            timer: 2000
        });
    } catch (error) {
        console.error('Error deleting task:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to delete task',
            confirmButtonColor: '#6366f1'
        });
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
                due_date: task.due_date || null,
                created_at: task.created_at || null
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
        // Stop all other running timers first
        const runningTasks = Object.keys(activeTimers);
        for (const runningTaskId of runningTasks) {
            if (parseInt(runningTaskId) !== taskId) {
                await stopTimer(parseInt(runningTaskId), false);
            }
        }

        // Start new timer
        await fetch(`/api/tasks/${taskId}/start-timer`, { method: 'POST' });
        activeTimers[taskId] = setInterval(() => {
            updateTaskTimer(taskId);
        }, 1000); // Update every second
        renderTodoList();
        renderKanban();
    } catch (error) {
        console.error('Error starting timer:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to start timer',
            confirmButtonColor: '#6366f1'
        });
    }
}

async function stopTimer(taskId, shouldReload = true) {
    try {
        await fetch(`/api/tasks/${taskId}/stop-timer`, { method: 'POST' });
        if (activeTimers[taskId]) {
            clearInterval(activeTimers[taskId]);
            delete activeTimers[taskId];
        }
        if (shouldReload) {
            await loadTasks();
        }
    } catch (error) {
        console.error('Error stopping timer:', error);
        if (shouldReload) {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: 'Failed to stop timer',
                confirmButtonColor: '#6366f1'
            });
        }
    }
}

function updateTaskTimer(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    // Increment time spent
    task.time_spent = (task.time_spent || 0) + 1;

    // Update display without full reload
    const taskElements = document.querySelectorAll(`[data-task-id="${taskId}"]`);
    taskElements.forEach(el => {
        const timeDisplay = el.querySelector('.task-time-display');
        if (timeDisplay) {
            timeDisplay.textContent = formatTime(task.time_spent);
        }
        const kanbanTimeDisplay = el.querySelector('.kanban-card-time');
        if (kanbanTimeDisplay) {
            kanbanTimeDisplay.textContent = `⏱️ ${formatTime(task.time_spent)}`;
        }
    });
}

// Utility functions
function formatTime(seconds) {
    if (!seconds) return '00:00:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
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

function formatDateShort(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const options = { month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

function checkIfOverdue(task) {
    if (!task.due_date || task.status === 'done') return false;

    const today = new Date();
    const dueDate = new Date(task.due_date);

    today.setHours(0, 0, 0, 0);
    dueDate.setHours(0, 0, 0, 0);

    return dueDate < today;
}

// Filter functions
function getFilteredTasks() {
    const searchFilter = document.getElementById('filter-search')?.value.toLowerCase() || '';
    const projectFilter = document.getElementById('filter-project')?.value || '';
    const priorityFilter = document.getElementById('filter-priority')?.value || '';
    const statusFilter = document.getElementById('filter-status')?.value || '';
    const dateFromFilter = document.getElementById('filter-date-from')?.value || '';
    const dateToFilter = document.getElementById('filter-date-to')?.value || '';

    return tasks.filter(task => {
        // Search filter
        if (searchFilter && !task.title.toLowerCase().includes(searchFilter)) return false;

        // Project filter
        if (projectFilter && task.project !== projectFilter) return false;

        // Priority filter
        if (priorityFilter && task.priority !== priorityFilter) return false;

        // Status filter
        if (statusFilter && task.status !== statusFilter) return false;

        // Date range filter (based on due_date)
        if (dateFromFilter && task.due_date) {
            if (task.due_date < dateFromFilter) return false;
        }
        if (dateToFilter && task.due_date) {
            if (task.due_date > dateToFilter) return false;
        }

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
    const currentView = document.querySelector('.view[style="display: block;"]');

    renderTodoList();
    renderKanban();

    // Reload dashboard if it's the current view
    if (currentView && currentView.id === 'dashboard-view') {
        loadDashboard();
    }

    // Re-render credentials if it's the current view
    if (currentView && currentView.id === 'credentials-view') {
        renderCredentials();
    }
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('task-modal');
    const credentialModal = document.getElementById('credential-modal');
    if (event.target === modal) {
        closeModal();
    }
    if (event.target === credentialModal) {
        closeCredentialModal();
    }
}

// ========== SERVER CREDENTIALS FUNCTIONS ==========

// Load credentials from API
async function loadCredentials() {
    try {
        const response = await fetch('/api/credentials');
        credentials = await response.json();
        await loadProjects(); // Load projects for dropdown
        populateCredentialProjectList();
        renderCredentials();
    } catch (error) {
        console.error('Error loading credentials:', error);
    }
}

// Populate project list for credential form
function populateCredentialProjectList() {
    const datalist = document.getElementById('credential-project-list');
    if (datalist) {
        datalist.innerHTML = '';

        // Get unique projects from tasks
        fetch('/api/projects')
            .then(response => response.json())
            .then(projects => {
                projects.forEach(project => {
                    const option = document.createElement('option');
                    option.value = project;
                    datalist.appendChild(option);
                });
            });
    }
}

// Get filtered credentials
function getFilteredCredentials() {
    let filtered = [...credentials];

    // Filter by search (title)
    const searchTerm = document.getElementById('filter-search').value.toLowerCase();
    if (searchTerm) {
        filtered = filtered.filter(cred =>
            cred.title.toLowerCase().includes(searchTerm) ||
            cred.ip.toLowerCase().includes(searchTerm)
        );
    }

    // Filter by project
    const projectFilter = document.getElementById('filter-project').value;
    if (projectFilter) {
        filtered = filtered.filter(cred => cred.project === projectFilter);
    }

    return filtered;
}

// Render credentials list
function renderCredentials() {
    const credentialsList = document.getElementById('credentials-list');
    credentialsList.innerHTML = '';

    const filteredCredentials = getFilteredCredentials();

    if (filteredCredentials.length === 0) {
        if (credentials.length === 0) {
            credentialsList.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 40px;">No credentials saved yet.</p>';
        } else {
            credentialsList.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 40px;">No credentials match the current filters.</p>';
        }
        return;
    }

    filteredCredentials.forEach(credential => {
        const card = document.createElement('div');
        card.className = 'credential-card';
        card.innerHTML = `
            <div class="credential-header">
                <div>
                    <div class="credential-title">${credential.title}</div>
                    ${credential.project ? `<span class="credential-project">📁 ${credential.project}</span>` : ''}
                </div>
                <div class="credential-actions">
                    <button class="btn-edit" onclick="editCredential(${credential.id})" title="Edit">✏️</button>
                    <button class="btn-delete" onclick="deleteCredential(${credential.id})" title="Delete">🗑️</button>
                </div>
            </div>
            <div class="credential-info">
                <div class="credential-field">
                    <span class="credential-label">🌐 IP Address</span>
                    <div class="credential-value-wrapper">
                        <div class="credential-value">${credential.ip}</div>
                        <div class="credential-btn-group">
                            <button class="copy-btn" onclick="copyToClipboard('${credential.ip}', event)">📋 Copy</button>
                        </div>
                    </div>
                </div>
                <div class="credential-field">
                    <span class="credential-label">🔑 Password</span>
                    <div class="credential-value-wrapper">
                        <div class="credential-value">
                            <input type="password" id="password-${credential.id}" value="${credential.password}" readonly>
                        </div>
                        <div class="credential-btn-group">
                            <button class="password-toggle" onclick="togglePassword(${credential.id}, event)" title="Show/Hide">👁️</button>
                            <button class="copy-btn" onclick="copyToClipboard('${credential.password}', event)">📋 Copy</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        credentialsList.appendChild(card);
    });
}

// Open add credential modal
function openAddCredentialModal() {
    document.getElementById('credential-modal-title').textContent = 'Add Server Credential';
    document.getElementById('credential-form').reset();
    document.getElementById('credential-id').value = '';
    document.getElementById('credential-modal').style.display = 'block';
}

// Close credential modal
function closeCredentialModal() {
    document.getElementById('credential-modal').style.display = 'none';
}

// Save credential
async function saveCredential(event) {
    event.preventDefault();

    const id = document.getElementById('credential-id').value;
    const credentialData = {
        title: document.getElementById('credential-title').value,
        project: document.getElementById('credential-project').value,
        ip: document.getElementById('credential-ip').value,
        password: document.getElementById('credential-password').value
    };

    try {
        let response;
        if (id) {
            response = await fetch(`/api/credentials/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(credentialData)
            });
        } else {
            response = await fetch('/api/credentials', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(credentialData)
            });
        }

        if (response.ok) {
            closeCredentialModal();
            await loadCredentials();
            Swal.fire({
                icon: 'success',
                title: id ? 'Credential Updated!' : 'Credential Added!',
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 2000,
                timerProgressBar: true
            });
        }
    } catch (error) {
        console.error('Error saving credential:', error);
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: 'Failed to save credential'
        });
    }
}

// Edit credential
function editCredential(id) {
    const credential = credentials.find(c => c.id === id);
    if (!credential) return;

    document.getElementById('credential-modal-title').textContent = 'Edit Server Credential';
    document.getElementById('credential-id').value = credential.id;
    document.getElementById('credential-title').value = credential.title;
    document.getElementById('credential-project').value = credential.project || '';
    document.getElementById('credential-ip').value = credential.ip;
    document.getElementById('credential-password').value = credential.password;

    document.getElementById('credential-modal').style.display = 'block';
}

// Delete credential
async function deleteCredential(id) {
    const result = await Swal.fire({
        title: 'Delete Credential?',
        text: 'This action cannot be undone!',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'Yes, delete it!',
        cancelButtonText: 'Cancel'
    });

    if (result.isConfirmed) {
        try {
            const response = await fetch(`/api/credentials/${id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                await loadCredentials();
                Swal.fire({
                    icon: 'success',
                    title: 'Deleted!',
                    text: 'Credential has been deleted.',
                    toast: true,
                    position: 'top-end',
                    showConfirmButton: false,
                    timer: 2000,
                    timerProgressBar: true
                });
            }
        } catch (error) {
            console.error('Error deleting credential:', error);
        }
    }
}

// Toggle password visibility
function togglePassword(id, e) {
    if (e) e.preventDefault();
    const input = document.getElementById(`password-${id}`);
    const button = e ? e.target : event.target;

    if (input.type === 'password') {
        input.type = 'text';
        button.textContent = '🙈';
    } else {
        input.type = 'password';
        button.textContent = '👁️';
    }
}

// Copy to clipboard
async function copyToClipboard(text, e) {
    if (e) e.preventDefault();
    try {
        await navigator.clipboard.writeText(text);
        Swal.fire({
            icon: 'success',
            title: 'Copied to clipboard!',
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 1500,
            timerProgressBar: true
        });
    } catch (error) {
        console.error('Error copying to clipboard:', error);
    }
}

