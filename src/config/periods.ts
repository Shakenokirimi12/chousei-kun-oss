export interface CustomPeriod {
    id: number;
    label: string;
    time: string;
}

export const CUSTOM_PERIODS: CustomPeriod[] = [
    { id: 1, label: "1限", time: "09:00-09:50" },
    { id: 2, label: "2限", time: "09:50-10:40" },
    { id: 3, label: "3限", time: "10:50-11:40" },
    { id: 4, label: "4限", time: "11:40-12:30" },
    { id: 5, label: "5限", time: "13:20-14:10" },
    { id: 6, label: "6限", time: "14:10-15:00" },
    { id: 7, label: "7限", time: "15:10-16:00" },
    { id: 8, label: "8限", time: "16:00-16:50" },
    { id: 9, label: "9限", time: "17:00-17:50" },
    { id: 10, label: "10限", time: "18:00-18:50" },
    { id: 11, label: "11限", time: "19:00-19:50" }
];