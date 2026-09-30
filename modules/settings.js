import { File, Paths } from "expo-file-system";

const settingsFile = () => new File(Paths.document, "settings.json");

// Returns the saved settings, or an empty object if there are none
export const loadSettings = () => {
    try {
        const file = settingsFile();
        return file.exists ? JSON.parse(file.textSync()) : {};
    } catch {
        return {};
    }
}

export const saveSettings = (settings) => {
    const file = settingsFile();
    file.create({ overwrite: true });
    file.write(JSON.stringify(settings));
}
