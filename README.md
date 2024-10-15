We use the Indexer API for our leaderboard. The architecture is as follows: 

![alt text](images/leaderboard.png)

1. A smart contract emits an AttackEvent with player data (attacker, defender, points, etc.).
2. A cron job uses the Indexer API to fetch these events via a GraphQL query.
3. The cron job extracts player information (address, points, name) and stores it in a Firebase database.
4. The Next.js frontend queries this database and displays a leaderboard, sorted by points in descending order.

This setup continuously updates the leaderboard based on real-time blockchain events.