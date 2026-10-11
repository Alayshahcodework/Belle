// Single source of truth for the routing matrix, the staff roles and the
// numbers the ETA model runs on. Imported by the server (Node) and the React
// app (Vite), so the patient UI, the staff board and the classifier can never
// drift apart.

export const DEPARTMENTS = {
  nursing: {
    id: 'nursing',
    name: 'Primary Nurse',
    nameEs: 'su enfermera',
    short: 'Nursing',
    clinical: true,
    accent: '#c0392f',
  },
  pct: {
    id: 'pct',
    name: 'Patient Care Tech',
    nameEs: 'asistencia al paciente',
    short: 'Care Techs',
    clinical: true,
    accent: '#b08a1e',
  },
  housekeeping: {
    id: 'housekeeping',
    name: 'Housekeeping & Facilities',
    nameEs: 'limpieza',
    short: 'Housekeeping',
    clinical: false,
    accent: '#2f7e63',
  },
  food: {
    id: 'food',
    name: 'Food Services',
    nameEs: 'servicio de comidas',
    short: 'Food Services',
    clinical: false,
    accent: '#4c6fa8',
  },
  unitclerk: {
    id: 'unitclerk',
    name: 'Unit Clerk / IT',
    nameEs: 'soporte tecnico',
    short: 'Unit Clerk',
    clinical: false,
    accent: '#6e7bb5',
  },
};

export const DEPARTMENT_ORDER = ['nursing', 'pct', 'housekeeping', 'food', 'unitclerk'];

// Staff roles. `department` is the queue this role owns -- the column that gets
// highlighted on the left of their board.
export const ROLES = {
  nurse: { id: 'nurse', label: 'Registered Nurse', department: 'nursing', seesPhi: true },
  charge: { id: 'charge', label: 'Charge Nurse', department: 'nursing', seesPhi: true },
  pct: { id: 'pct', label: 'Patient Care Tech', department: 'pct', seesPhi: true },
  housekeeping: {
    id: 'housekeeping',
    label: 'Housekeeping',
    department: 'housekeeping',
    seesPhi: true,
  },
  food: { id: 'food', label: 'Food Services', department: 'food', seesPhi: true },
  unitclerk: { id: 'unitclerk', label: 'Unit Clerk', department: 'unitclerk', seesPhi: true },
};

export const PRIORITY = {
  critical: { id: 'critical', label: 'Urgent', rank: 0 },
  high: { id: 'high', label: 'Priority', rank: 1 },
  normal: { id: 'normal', label: 'Routine', rank: 2 },
};

// Measured mean handling time per category, in minutes.
// Sourced from the team's floor timings; see docs in README.
export const SERVICE_MINUTES = {
  urgent_clinical: 1.5, // ASSUMPTION: response target, not a measured average
  clinical: 5.75, // "medication times"
  mobility: 9.22, // "bathroom requests" 9:13
  dietary: 5.48, // "water/ice, eat"
  comfort: 5.48, // "blanket/pillow"
  room_environment: 6.0, // "room cleaning"
  tech_amenities: 4.0, // "TV, phones, lights"
  admin: 8.0, // ASSUMPTION: no measured value supplied
  unclassified: 5.75, // treated as a clinical review
};

export const CATEGORIES = {
  urgent_clinical: {
    id: 'urgent_clinical',
    label: 'Urgent Clinical',
    department: 'nursing',
    priority: 'critical',
  },
  clinical: {
    id: 'clinical',
    label: 'Clinical / Pain',
    department: 'nursing',
    priority: 'high',
  },
  mobility: {
    id: 'mobility',
    label: 'Mobility / Toileting',
    department: 'pct',
    priority: 'high',
  },
  dietary: {
    id: 'dietary',
    label: 'Dietary / Refreshment',
    department: 'food',
    priority: 'normal',
  },
  room_environment: {
    id: 'room_environment',
    label: 'Room Environment / Cleaning',
    department: 'housekeeping',
    priority: 'normal',
  },
  comfort: {
    id: 'comfort',
    label: 'Comfort / Linens',
    department: 'housekeeping',
    priority: 'normal',
  },
  tech_amenities: {
    id: 'tech_amenities',
    label: 'Tech Support / Amenities',
    department: 'unitclerk',
    priority: 'normal',
  },
  admin: {
    id: 'admin',
    label: 'Questions / Admin',
    department: 'unitclerk',
    priority: 'normal',
  },
  unclassified: {
    id: 'unclassified',
    label: 'Needs Human Triage',
    department: 'nursing',
    priority: 'high',
  },
};

// Secondary buttons under the microphone on the patient screen.
export const QUICK_ACTIONS = [
  { id: 'water', label: 'Water or ice', icon: '💧', category: 'dietary', text: 'Water or ice.' },
  {
    id: 'snack',
    label: 'Something to eat',
    icon: '🍽️',
    category: 'dietary',
    text: 'Something to eat.',
  },
  {
    id: 'linens',
    label: 'Blanket or pillow',
    icon: '🛏️',
    category: 'comfort',
    text: 'An extra blanket or pillow.',
  },
  {
    id: 'bathroom',
    label: 'Help to bathroom',
    icon: '🚻',
    category: 'mobility',
    text: 'Help getting to the bathroom.',
  },
  {
    id: 'tv',
    label: 'TV, phone or lights',
    icon: '📺',
    category: 'tech_amenities',
    text: 'Help with the TV, phone or room lights.',
  },
  {
    id: 'clean',
    label: 'Room needs cleaning',
    icon: '🧹',
    category: 'room_environment',
    text: 'Room needs cleaning.',
  },
];

export const NURSE_ACTION = {
  id: 'nurse',
  label: "I don't feel well — get my nurse",
  icon: '🚨',
  category: 'urgent_clinical',
  text: 'Patient pressed the nurse button directly.',
};

export const STATUSES = {
  new: { id: 'new', label: 'New', patientLabel: 'Sent' },
  accepted: { id: 'accepted', label: 'In progress', patientLabel: 'On the way' },
  done: { id: 'done', label: 'Complete', patientLabel: 'Done' },
};

export function departmentFor(categoryId) {
  const category = CATEGORIES[categoryId] ?? CATEGORIES.unclassified;
  return DEPARTMENTS[category.department];
}

export function serviceMinutesFor(categoryId) {
  return SERVICE_MINUTES[categoryId] ?? SERVICE_MINUTES.unclassified;
}
