
import { createRouter, createWebHistory } from 'vue-router'

import AdminView from '../views/AdminView.vue'
import EmployeeView from '../views/EmployeeView.vue'

const routes = [
  {
    path: '/',
    redirect: '/employee'
  },
  {
    path: '/employee',
    name: 'Employee',
    component: EmployeeView
  },
  {
    path: '/admin',
    name: 'Admin',
    component: AdminView
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
