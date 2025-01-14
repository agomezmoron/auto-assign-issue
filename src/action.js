const pickNRandomFromArray = (arr, n) => {
    if (arr.length === 0) {
        throw new Error('Can not pick random from empty list.');
    }
    const available = [...arr];
    const result = [];
    for (let i = 0; i < n && available.length > 0; i++) {
        const randomIndex = Math.floor(Math.random() * available.length);
        result.push(available.splice(randomIndex, 1)[0]);
    }
    return result;
};

const getTeamMembers = async (octokit, org, teamNames) => {
    const teamMemberRequests = await Promise.all(
        teamNames.map((teamName) =>
            octokit.rest.teams.listMembersInOrg({
                org,
                team_slug: teamName
            })
        )
    ).catch((err) => {
        const newErr = new Error('Failed to retrieve team members');
        newErr.stack += `\nCaused by: ${err.stack}`;
        throw newErr;
    });
    return teamMemberRequests
        .map((response) => response.data)
        .reduce((all, cur) => all.concat(cur), [])
        .map((user) => user.login);
};

const removeAllAssignees = async (octokit, owner, repo, issue_number) => {
    try {
        const issue = await octokit.rest.issues.get({
            owner,
            repo,
            issue_number
        });
        const assignees = issue.data.assignees.map(
            (assignee) => assignee.login
        );
        console.log(
            `Remove issue ${issue} assignees ${JSON.stringify(assignees)}`
        );
        await octokit.rest.issues.removeAssignees({
            owner,
            repo,
            issue_number,
            assignees
        });
    } catch (err) {
        const newErr = new Error('Failed to remove previous assignees');
        newErr.stack += `\nCaused by: ${err.stack}`;
        throw newErr;
    }
};

/**
 * Runs the auto-assign issue action
 * @param {Object} octokit
 * @param {Object} context
 * @param {Object} parameters
 * @param {string} parameters.assigneesString
 * @param {string} parameters.teamsString
 * @param {string} parameters.numOfAssigneeString
 * @param {boolean} parameters.removePreviousAssignees
 * @param {boolean} parameters.allowSelfAssign
 */
const runAction = async (octokit, context, parameters) => {
    const {
        assigneesString,
        teamsString,
        numOfAssigneeString,
        removePreviousAssignees = false,
        allowSelfAssign = true
    } = parameters;

    // Get issue info from context
    let issueNumber = context.issue?.number || context.pull_request?.number;
    const author =
        context.issue?.user.login || context.pull_request?.user.login;
    // If the issue is not found directly, maybe it came for a card movement with a linked issue
    if (
        !issueNumber &&
        context?.project_card?.content_url?.includes('issues')
    ) {
        const contentUrlParts = context.project_card.content_url.split('/');
        issueNumber = parseInt(contentUrlParts[contentUrlParts.length - 1], 10);
    }
    if (!issueNumber) {
        console.error(JSON.stringify(context));
        throw new Error(`Couldn't find issue info in current context`);
    }

    // Get org owner and repo name from context
    const [owner, repo] = context.repository.full_name.split('/');

    // Check assignees and teams parameters
    if (
        (!assigneesString || !assigneesString.trim()) &&
        (!teamsString || !teamsString.trim())
    ) {
        throw new Error(
            'Missing required parameters: you must provide assignees or teams'
        );
    }
    let numOfAssignee = 0;
    if (numOfAssigneeString) {
        numOfAssignee = parseInt(numOfAssigneeString, 10);
        if (isNaN(numOfAssignee)) {
            throw new Error(
                `Invalid value ${numOfAssigneeString} for numOfAssignee`
            );
        }
    }

    // Get issue assignees
    let assignees = [];

    // Get users
    if (assigneesString) {
        assignees = assigneesString
            .split(',')
            .map((assigneeName) => assigneeName.trim());
    }
    // Get team members
    if (teamsString) {
        const teamNames = teamsString
            .split(',')
            .map((teamName) => teamName.trim());
        if (teamNames) {
            const teamMembers = await getTeamMembers(octokit, owner, teamNames);
            assignees = assignees.concat(teamMembers);
        }
    }

    // Remove duplicates from assignees
    assignees = [...new Set(assignees)];

    // Remove author if allowSelfAssign is disabled
    if (!allowSelfAssign) {
        const foundIndex = assignees.indexOf(author);
        if (foundIndex !== -1) {
            assignees.splice(foundIndex, 1);
        }
    }

    // Check if there are assignees left
    if (assignees.length === 0) {
        throw new Error('No candidates left for assignement');
    }

    // Select random assignees
    if (numOfAssignee) {
        assignees = pickNRandomFromArray(assignees, numOfAssignee);
    }

    // Remove previous assignees if needed
    if (removePreviousAssignees) {
        await removeAllAssignees(octokit, owner, repo, issueNumber);
    }

    // Assign issue
    console.log(
        `Assigning issue ${issueNumber} to users ${JSON.stringify(assignees)}`
    );
    await octokit.rest.issues.addAssignees({
        owner,
        repo,
        issue_number: issueNumber,
        assignees
    });
};

module.exports = {
    getTeamMembers,
    pickNRandomFromArray,
    runAction
};
