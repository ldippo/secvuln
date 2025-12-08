I want to create a cli tool for typescript projects to help manage security vulnerability remediation present in an npm/yarn/pnpm audit

My thoughts would be the following.

Requirements: 
- I'd like to utilize something like prompt js to inform which decisions I would like to action
- I'd like very transparent reporting on what recommended course of action / actions taken are
- I'd like a summary of what ocurred in accordance with severity level
- For major version changes I want to highlight what recommended changes are and the nature of changes to best inform developers with respect to testing / considering if a major version change would be significant or difficult to account for
- For minor version changes I would like to check the projects changelog to see if there is anything of note or breaking worth highlighting - if not I would like to optimistically make the version change to resolve the vulnerability
- For patch version changes I would like to optimistically resolve the vulnerability
- If we have vulnerabilities in transient child dependencies I would like to see if the parent package (explicitly present in package.json) that is using it has a patch or minor version adressing the resolution.
- If we have vulnerabilities in transient child deps that have not had their parent package address the concern I would like to patch the vulnerability via package.json resolutions
- I would like a prompt that looks for test/build commands that lets me selection which actions to run to confirm the code changes were not breaking