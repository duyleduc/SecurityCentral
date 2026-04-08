-- Grant CREATE/DROP privileges for Prisma shadow database
GRANT CREATE, ALTER, DROP, REFERENCES ON *.* TO 'securitycentral'@'%';
FLUSH PRIVILEGES;
