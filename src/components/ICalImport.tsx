"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Calendar as CalendarIcon } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";

interface ICalImportProps {
    onImport: (url: string) => Promise<void>;
    buttonLabel?: string;
    description?: string;
    actionLabel?: string;
}

export default function ICalImport({
    onImport,
    buttonLabel = "iCal形式のURL",
    description = "iCal形式のURL（Googleカレンダーの「非公開URL」など）を入力して、予定をインポートします。",
    actionLabel = "インポート"
}: ICalImportProps) {
    const [isOpen, setIsOpen] = React.useState(false);
    const [url, setUrl] = React.useState("");
    const [isImporting, setIsImporting] = React.useState(false);

    const handleImport = async () => {
        if (!url) return;
        setIsImporting(true);
        try {
            await onImport(url);
            setIsOpen(false);
            setUrl("");
        } catch (error) {
            console.error(error);
        } finally {
            setIsImporting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" type="button" className="gap-2">
                    <CalendarIcon className="h-4 w-4" />
                    {buttonLabel}
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>iCal形式のURLからインポート</DialogTitle>
                    <DialogDescription>
                        {description}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <label htmlFor="ical-url" className="text-sm font-medium">iCal URL</label>
                        <Input 
                            id="ical-url" 
                            value={url} 
                            onChange={e => setUrl(e.target.value)} 
                            placeholder="https://example.com/calendar.ics" 
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={handleImport} disabled={isImporting || !url}>
                        {isImporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {actionLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
