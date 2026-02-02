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
