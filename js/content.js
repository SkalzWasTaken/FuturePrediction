import { round, score } from './score.js';

/**
 * Path to directory containing `_list.json` and all levels
 */
const dir = '/data';

/**
 * Parse percent value which can be a number, string range, or array
 * Returns { display, calculate } where display is what to show and calculate is the percent for scoring
 */
function parsePercent(percent) {
    if (typeof percent === 'number') {
        return { display: percent, calculate: percent };
    }
    
    if (typeof percent === 'string') {
        // Handle "72-100" format - calculate as max - min
        const parts = percent.split('-');
        if (parts.length === 2) {
            const min = parseInt(parts[0]);
            const max = parseInt(parts[1]);
            return { display: percent, calculate: max - min };
        }
        return { display: percent, calculate: parseInt(percent) || 0 };
    }
    
    if (Array.isArray(percent)) {
        // For arrays, sum up all the calculated percentages
        const parsed = percent.map(p => parsePercent(p));
        const totalCalculate = parsed.reduce((sum, p) => sum + p.calculate, 0);
        const display = parsed.map(p => p.display).join(', ');
        return { display, calculate: totalCalculate };
    }
    
    return { display: 0, calculate: 0 };
}

export async function fetchList() {
    const listResult = await fetch(`${dir}/_list.json`);
    try {
        const list = await listResult.json();
        return await Promise.all(
            list.map(async (path, rank) => {
                const levelResult = await fetch(`${dir}/${path}.json`);
                try {
                    const level = await levelResult.json();
                    return [
                        {
                            ...level,
                            path,
                            records: level.records.sort((a, b) => {
                                const aCalc = parsePercent(a.percent).calculate;
                                const bCalc = parsePercent(b.percent).calculate;
                                return bCalc - aCalc;
                            }),
                        },
                        null,
                    ];
                } catch {
                    console.error(`Failed to load level #${rank + 1} ${path}.`);
                    return [null, path];
                }
            }),
        );
    } catch {
        console.error(`Failed to load list.`);
        return null;
    }
}

export async function fetchEditors() {
    try {
        const editorsResults = await fetch(`${dir}/_editors.json`);
        const editors = await editorsResults.json();
        return editors;
    } catch {
        return null;
    }
}

export async function fetchLeaderboard() {
    const list = await fetchList();

    const scoreMap = {};
    const errs = [];
    list.forEach(([level, err], rank) => {
        if (err) {
            errs.push(err);
            return;
        }

        // Verification - only add verifier if it's a non-empty string
        const verifierRaw = level.verifier?.toString().trim();
        if (verifierRaw) {
            const verifier = Object.keys(scoreMap).find(
                (u) => u.toLowerCase() === verifierRaw.toLowerCase(),
            ) || verifierRaw;
            scoreMap[verifier] ??= {
                verified: [],
                completed: [],
                progressed: [],
            };
            const { verified } = scoreMap[verifier];
            verified.push({
                rank: rank + 1,
                level: level.name,
                score: score(rank + 1, 100, level.percentToQualify),
                link: level.verification,
            });
        }

        // Records
        level.records.forEach((record) => {
            const user = Object.keys(scoreMap).find(
                (u) => u.toLowerCase() === record.user.toLowerCase(),
            ) || record.user;
            scoreMap[user] ??= {
                verified: [],
                completed: [],
                progressed: [],
            };
            const { completed, progressed } = scoreMap[user];
            
            const { display, calculate } = parsePercent(record.percent);
            
            if (calculate === 100) {
                completed.push({
                    rank: rank + 1,
                    level: level.name,
                    score: score(rank + 1, 100, level.percentToQualify),
                    link: record.link,
                });
                return;
            }

            progressed.push({
                rank: rank + 1,
                level: level.name,
                percent: display,
                score: score(rank + 1, calculate, level.percentToQualify),
                link: record.link,
            });
        });
    });

    // Wrap in extra Object containing the user and total score
    const res = Object.entries(scoreMap).map(([user, scores]) => {
        const { verified, completed, progressed } = scores;
        const total = [verified, completed, progressed]
            .flat()
            .reduce((prev, cur) => prev + cur.score, 0);

        return {
            user,
            total: round(total),
            ...scores,
        };
    });

    // Sort by total score
    return [res.sort((a, b) => b.total - a.total), errs];
}
