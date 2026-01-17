import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const data = [
    { name: 'Jan', uv: 4000, pv: 2400, amt: 2400 },
    { name: 'Feb', uv: 3000, pv: 1398, amt: 2210 },
    { name: 'Mar', uv: 2000, pv: 9800, amt: 2290 },
    { name: 'Apr', uv: 2780, pv: 3908, amt: 2000 },
    { name: 'May', uv: 1890, pv: 4800, amt: 2181 },
    { name: 'Jun', uv: 2390, pv: 3800, amt: 2500 },
    { name: 'Jul', uv: 3490, pv: 4300, amt: 2100 },
];

const Dashboard = () => {
    return (
        <div>
            <div className="card-grid">
                <div className="card">
                    <h3>Total Users</h3>
                    <div className="value">1,234</div>
                </div>
                <div className="card">
                    <h3>Revenue</h3>
                    <div className="value">$45,678</div>
                </div>
                <div className="card">
                    <h3>Active Sessions</h3>
                    <div className="value">890</div>
                </div>
            </div>

            <div className="chart-container">
                <h3>Overview</h3>
                <ResponsiveContainer width="100%" height="90%">
                    <BarChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="uv" fill="#3b82f6" />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default Dashboard;
