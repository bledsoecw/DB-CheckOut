/** Sample data so the app runs in demo mode before the sync server is deployed. */
import type { JobDetail, QueueJob } from "@shared/types";
import { STATUS } from "@shared/jobtread";

export const MOCK_JOBS: QueueJob[] = [
  {
    id: "demo-hartman",
    number: "26-0418",
    name: "26-0418 Hartman_Roof",
    status: STATUS.finalInspection,
    jobType: "Roofing",
    projectTypes: ["R-Shingles"],
    isService: false,
    projectManager: "Neal Deitemeyer",
    salesRep: "Austin Leeth",
    address: "1427 Prairie View Dr, Lincoln NE",
    openPunchCount: 0,
  },
  {
    id: "demo-okafor",
    number: "26-0415",
    name: "26-0415 Okafor_Roof",
    status: STATUS.punchList,
    jobType: "Roofing",
    projectTypes: ["R-Repairs/Service"],
    isService: true,
    projectManager: "Dave Elick",
    salesRep: "Sam Black",
    address: "88 Cedar Falls Ct, Waverly NE",
    openPunchCount: 2,
  },
];

export function mockJobDetail(jobId: string): JobDetail {
  const base = MOCK_JOBS.find((j) => j.id === jobId) ?? MOCK_JOBS[0];
  if (base.status === STATUS.punchList) {
    return {
      ...base,
      punchTasks: [
        {
          id: "demo-task-1",
          name: "Bajante — esquina noreste / Downspout, NE corner",
          description: "Reconnect and strap the downspout.",
          progress: 1,
          endDate: null,
          assigneeNames: ["José R."],
        },
        {
          id: "demo-task-2",
          name: "Bota del tubo — atrás / Pipe boot, rear slope",
          description: "Replace the 3\" pipe boot and re-seal the surrounding shingles. Bring: 3\" boot, sealant.",
          progress: 0,
          endDate: null,
          assigneeNames: ["José R."],
        },
        {
          id: "demo-task-3",
          name: "Flashing — pared oeste / Step flashing, west wall",
          description: "Reset siding over step flashing at second course.",
          progress: 0,
          endDate: null,
          assigneeNames: ["José R."],
        },
      ],
    };
  }
  return { ...base, punchTasks: [] };
}
