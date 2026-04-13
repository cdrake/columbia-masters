export interface SiteEvent {
  date: string;
  endDate: string;
  title: string;
  location: string;
  notes: string;
  url: string;
}

export interface ScheduleEntry {
  day: string;
  time: string;
  type: string;
  location?: string;
}

export interface BoardMember {
  role: string;
  name: string;
}

export interface SiteContent {
  key: string;
  value: string;
}

export interface GalleryEvent {
  slug: string;
  name: string;
  date: string;
  description: string;
  type: "meet" | "social";
  course: string;
  photos: { file: string; caption: string }[];
}

export interface TeamRecord {
  id: string;
  team: string;
  event: string;
  course: string;
  gender: string;
  ageGroup: string;
  time: string;
  timeInSeconds: number;
  swimmer: string;
  date: string | null;
  meet: string;
  year: string | null;
}
