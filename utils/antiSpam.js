const users = {};
function isSpamming(jid) {
    const now = Date.now();
    if (!users[jid]) users[jid] = { last: now, count: 0 };
    if (now - users[jid].last < 2000) {
        users[jid].count++;
        return users[jid].count > 5;
    }
    users[jid].count = 0;
    users[jid].last = now;
    return false;
}
module.exports = { isSpamming };
